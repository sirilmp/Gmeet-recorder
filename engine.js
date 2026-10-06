// Recording engine using WebCodecs: video + audio tracks -> hardware H.264 + AAC -> fragmented MP4,
// written straight to a file on disk while recording (like OBS: no big buffers, and a crash keeps
// everything up to the last few seconds). If a frame can't be encoded in time it is dropped instead
// of piling up in memory.
const MeetEngine = {
  supported() {
    return (
      typeof VideoEncoder !== "undefined" &&
      typeof AudioEncoder !== "undefined" &&
      typeof MediaStreamTrackProcessor !== "undefined" &&
      typeof Mp4Muxer !== "undefined"
    );
  },

  // H.264 High profile; the level has to be high enough for big frames
  videoCodec(w, h) {
    const px = w * h;
    return px <= 1920 * 1088 ? "avc1.640028" : px <= 2560 * 1440 ? "avc1.640032" : "avc1.640034";
  },

  // opts: { videoTrack, audioTrack, writable, fps, vbps, abps, sampleRate, channels }
  // Returns { stop(): Promise, stats(): {...} }. Throws if this PC can't encode what was asked.
  async create(opts) {
    const { videoTrack, audioTrack, writable, fps, vbps } = opts;
    const abps = opts.abps || 96_000;
    const sampleRate = opts.sampleRate || 48000;
    const channels = opts.channels || 2;
    const KEY_EVERY_US = 2_000_000; // a keyframe every 2 s: good seeking, quick recovery
    const MAX_QUEUE = 6; // frames waiting for the encoder; beyond this we drop

    const vReader = new MediaStreamTrackProcessor({ track: videoTrack }).readable.getReader();
    let aReader = null;
    let muxer = null;
    let venc = null;
    let aenc = null;
    let stopping = false;
    let failure = null;
    const st = { frames: 0, dropped: 0, bytes: 0, hardware: false, codec: "", w: 0, h: 0, audio: "" };

    const fail = (e) => {
      if (!failure) failure = e;
      stopping = true;
    };

    // Everything is set up from the first real frame, so the file gets the true capture size
    const first = await vReader.read();
    if (first.done || !first.value) throw new Error("No video frames arrived");
    const f0 = first.value;
    const w = f0.displayWidth & ~1; // H.264 wants even sizes
    const h = f0.displayHeight & ~1;
    st.w = w;
    st.h = h;

    const codec = MeetEngine.videoCodec(w, h);
    let vcfg = {
      codec,
      width: w,
      height: h,
      bitrate: vbps,
      framerate: fps,
      latencyMode: "realtime",
      avc: { format: "avc" },
    };
    let support = await VideoEncoder.isConfigSupported({ ...vcfg, hardwareAcceleration: "prefer-hardware" });
    if (!support.supported) throw new Error(`This PC cannot encode ${w}x${h} H.264`);
    vcfg = support.config;
    st.codec = codec;
    st.hardware = (vcfg.hardwareAcceleration || "") !== "prefer-software";
    if (!st.hardware && w * h > 1920 * 1088) throw new Error("No hardware encoder for this size");

    // Audio: AAC if possible (plays everywhere), else Opus
    let acodec = "mp4a.40.2";
    let acfg = { codec: acodec, sampleRate, numberOfChannels: channels, bitrate: abps };
    let asupport = await AudioEncoder.isConfigSupported(acfg);
    let muxAudio = "aac";
    if (!asupport.supported) {
      acodec = "opus";
      acfg = { codec: acodec, sampleRate, numberOfChannels: channels, bitrate: abps };
      asupport = await AudioEncoder.isConfigSupported(acfg);
      muxAudio = "opus";
      if (!asupport.supported) throw new Error("No supported audio encoder");
    }
    st.audio = muxAudio;

    muxer = new Mp4Muxer.Muxer({
      target: new Mp4Muxer.FileSystemWritableFileStreamTarget(writable, { chunkSize: 1 << 20 }),
      video: { codec: "avc", width: w, height: h, frameRate: fps },
      audio: { codec: muxAudio, numberOfChannels: channels, sampleRate },
      fastStart: "fragmented",
      minFragmentDuration: 2,
      firstTimestampBehavior: "offset",
    });

    venc = new VideoEncoder({
      output: (chunk, meta) => {
        st.bytes += chunk.byteLength;
        try {
          muxer.addVideoChunk(chunk, meta);
        } catch (e) {
          fail(e);
        }
      },
      error: fail,
    });
    venc.configure(vcfg);

    aenc = new AudioEncoder({
      output: (chunk, meta) => {
        st.bytes += chunk.byteLength;
        try {
          muxer.addAudioChunk(chunk, meta);
        } catch (e) {
          fail(e);
        }
      },
      error: fail,
    });
    aenc.configure(asupport.config);

    // The tracks' own timestamps come from different clocks (the audio one can be minutes away from the
    // video one), so both tracks get a clean timeline that starts at 0: video = capture time of the
    // frame relative to the first frame, audio = number of samples written so far.
    const vOrigin = f0.timestamp;
    let lastKey = -Infinity;
    let lastTs = -1;
    const encodeFrame = (frame) => {
      if (venc.encodeQueueSize > MAX_QUEUE) {
        st.dropped++;
        frame.close();
        return;
      }
      let ts = frame.timestamp - vOrigin;
      if (ts <= lastTs) ts = lastTs + 1;
      lastTs = ts;
      const key = ts - lastKey >= KEY_EVERY_US;
      if (key) lastKey = ts;
      const nf = new VideoFrame(frame, { timestamp: ts });
      frame.close();
      venc.encode(nf, { keyFrame: key });
      nf.close();
      st.frames++;
    };

    let aSamples = 0;
    const encodeAudio = (data) => {
      const planar = data.format.endsWith("-planar");
      const n = data.numberOfFrames;
      const ch = data.numberOfChannels;
      const bytes = (data.format.startsWith("f32") ? 4 : data.format.startsWith("s32") ? 4 : data.format.startsWith("s16") ? 2 : 1);
      const buf = new ArrayBuffer(n * ch * bytes);
      if (planar) for (let c = 0; c < ch; c++) data.copyTo(new Uint8Array(buf, c * n * bytes, n * bytes), { planeIndex: c });
      else data.copyTo(new Uint8Array(buf), { planeIndex: 0 });
      const out = new AudioData({
        format: data.format,
        sampleRate: data.sampleRate,
        numberOfFrames: n,
        numberOfChannels: ch,
        timestamp: Math.round((aSamples / data.sampleRate) * 1e6),
        data: buf,
      });
      aSamples += n;
      data.close();
      aenc.encode(out);
      out.close();
    };

    encodeFrame(f0);
    const videoLoop = (async () => {
      try {
        while (!stopping) {
          const { value, done } = await vReader.read();
          if (done) break;
          if (stopping) {
            value.close();
            break;
          }
          encodeFrame(value);
        }
      } catch (e) {
        if (!stopping) fail(e);
      }
    })();

    let audioLoop = Promise.resolve();
    if (audioTrack) {
      // Audio is read on this page's main thread, which also draws and encodes the video. The default
      // queue only holds ~100 ms of sound, so any longer stall (a big frame, a slow CPU that clocked down
      // because nobody is touching the mouse) silently drops audio and the recording sounds robotic.
      // Keep a few seconds of headroom instead; audio chunks are tiny.
      aReader = new MediaStreamTrackProcessor({ track: audioTrack, maxBufferSize: 300 }).readable.getReader();
      audioLoop = (async () => {
        try {
          while (!stopping) {
            const { value, done } = await aReader.read();
            if (done) break;
            if (stopping) {
              value.close();
              break;
            }
            encodeAudio(value);
          }
        } catch (e) {
          if (!stopping) fail(e);
        }
      })();
    }

    return {
      stats: () => ({ ...st, queue: venc ? venc.encodeQueueSize : 0, failed: failure ? failure.message : null }),
      failure: () => failure,
      // Finish the file. The tracks are NOT stopped here (the caller does that).
      async stop() {
        stopping = true;
        await vReader.cancel().catch(() => {});
        if (aReader) await aReader.cancel().catch(() => {});
        await Promise.all([videoLoop, audioLoop]);
        try {
          if (venc.state === "configured") await venc.flush();
          if (aenc.state === "configured") await aenc.flush();
          muxer.finalize();
          await writable.close();
        } finally {
          try {
            venc.close();
          } catch {}
          try {
            aenc.close();
          } catch {}
        }
        if (failure) throw failure;
      },
    };
  },
};
