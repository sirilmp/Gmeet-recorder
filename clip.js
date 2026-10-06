// Cut a short clip out of a recording, on this PC.
// MP4 recordings (the WebCodecs engine writes fragmented MP4) are cut without re-encoding: the
// fragments are read straight from the file, the samples in the range are copied into a new, normal
// MP4 (moov up front, so it previews and uploads everywhere). That takes a second, even for long clips,
// and the quality is the original's. The clip starts on the keyframe at or just before the start
// (one every 2 s). WebM recordings (the MediaRecorder fallback) can't be cut that way: they are played
// in the background and recorded again, which takes as long as the clip.
const MeetClip = (() => {
  const fourcc = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  const u64 = (dv, o) => dv.getUint32(o) * 2 ** 32 + dv.getUint32(o + 4);
  const read = async (blob, pos, len) => new DataView(await blob.slice(pos, pos + len).arrayBuffer());

  // The boxes inside [start, end) of a DataView
  function* boxes(dv, start, end) {
    let o = start;
    while (o + 8 <= end) {
      let size = dv.getUint32(o);
      let hdr = 8;
      if (size === 1) {
        size = u64(dv, o + 8);
        hdr = 16;
      } else if (size === 0) size = end - o;
      if (size < hdr) break;
      yield { type: fourcc(dv, o + 4), body: o + hdr, end: Math.min(o + size, end) };
      o += size;
    }
  }
  const child = (dv, box, type) => {
    for (const b of boxes(dv, box.body, box.end)) if (b.type === type) return b;
    return null;
  };
  const path = (dv, box, ...types) => types.reduce((b, t) => b && child(dv, b, t), box);
  const bytes = (dv, from, to) => new Uint8Array(dv.buffer, dv.byteOffset + from, to - from).slice();

  // MPEG-4 descriptor length: 1 to 4 bytes, 7 bits each
  function descLen(dv, o) {
    let len = 0;
    for (let i = 0; i < 4; i++) {
      const b = dv.getUint8(o++);
      len = (len << 7) | (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    return { len, o };
  }
  // AudioSpecificConfig out of an esds box (ES_Descriptor > DecoderConfigDescriptor > DecSpecificInfo)
  function ascOf(dv, esds) {
    let o = esds.body + 4;
    while (o < esds.end) {
      const tag = dv.getUint8(o);
      const d = descLen(dv, o + 1);
      if (tag === 3) {
        const flags = dv.getUint8(d.o + 2);
        o = d.o + 3 + (flags & 0x80 ? 2 : 0);
        if (flags & 0x40) o += 1 + dv.getUint8(o);
        if (flags & 0x20) o += 2;
      } else if (tag === 4) o = d.o + 13;
      else if (tag === 5) return bytes(dv, d.o, d.o + d.len);
      else o = d.o + d.len;
    }
    return null;
  }

  // The tracks of the moov box: id, timescale, kind and what the new file needs to describe them
  function parseMoov(dv) {
    const moov = { body: 0, end: dv.byteLength };
    const tracks = new Map();
    for (const trak of boxes(dv, 0, dv.byteLength)) {
      if (trak.type !== "trak") continue;
      const tkhd = child(dv, trak, "tkhd");
      const mdhd = path(dv, trak, "mdia", "mdhd");
      const hdlr = path(dv, trak, "mdia", "hdlr");
      const stbl = path(dv, trak, "mdia", "minf", "stbl");
      const stsd = stbl && child(dv, stbl, "stsd");
      if (!tkhd || !mdhd || !hdlr || !stsd) continue;
      const id = dv.getUint32(tkhd.body + (dv.getUint8(tkhd.body) === 1 ? 20 : 12));
      const timescale = dv.getUint32(mdhd.body + (dv.getUint8(mdhd.body) === 1 ? 20 : 12));
      const handler = fourcc(dv, hdlr.body + 8);
      const stsz = child(dv, stbl, "stsz");
      const flat = stsz && dv.getUint32(stsz.body + 8) > 0; // samples listed in the moov: not fragmented
      const entry = boxes(dv, stsd.body + 8, stsd.end).next().value;
      if (!entry) continue;
      const t = { id, timescale, flat, samples: [] };
      if (handler === "vide" && (entry.type === "avc1" || entry.type === "avc3")) {
        const avcC = child(dv, { body: entry.body + 78, end: entry.end }, "avcC");
        if (!avcC) continue;
        const hex = (o) => dv.getUint8(avcC.body + o).toString(16).padStart(2, "0");
        t.kind = "video";
        t.width = dv.getUint16(entry.body + 24);
        t.height = dv.getUint16(entry.body + 26);
        t.config = {
          codec: `avc1.${hex(1)}${hex(2)}${hex(3)}`,
          codedWidth: t.width,
          codedHeight: t.height,
          description: bytes(dv, avcC.body, avcC.end),
        };
      } else if (handler === "soun" && (entry.type === "mp4a" || entry.type === "Opus")) {
        t.kind = "audio";
        t.channels = dv.getUint16(entry.body + 16);
        t.sampleRate = dv.getUint32(entry.body + 24) >>> 16 || timescale;
        if (entry.type === "mp4a") {
          const esds = child(dv, { body: entry.body + 28, end: entry.end }, "esds");
          const asc = esds && ascOf(dv, esds);
          if (!asc) continue;
          t.codec = "aac";
          t.config = { codec: `mp4a.40.${asc[0] >> 3}`, sampleRate: t.sampleRate, numberOfChannels: t.channels, description: asc };
        } else {
          t.codec = "opus";
          t.config = { codec: "opus", sampleRate: t.sampleRate, numberOfChannels: t.channels };
          const dOps = child(dv, { body: entry.body + 28, end: entry.end }, "dOps");
          if (dOps) {
            // dOps (big-endian) -> OpusHead (little-endian), which carries the pre-skip and gain
            const head = new DataView(new ArrayBuffer(19));
            "OpusHead".split("").forEach((c, i) => head.setUint8(i, c.charCodeAt(0)));
            head.setUint8(8, 1);
            head.setUint8(9, dv.getUint8(dOps.body + 1));
            head.setUint16(10, dv.getUint16(dOps.body + 2), true);
            head.setUint32(12, dv.getUint32(dOps.body + 4), true);
            head.setInt16(16, dv.getInt16(dOps.body + 8), true);
            t.config.description = new Uint8Array(head.buffer);
          }
        }
      } else continue;
      tracks.set(id, t);
    }
    // Fragment defaults per track
    const mvex = child(dv, moov, "mvex");
    if (mvex)
      for (const b of boxes(dv, mvex.body, mvex.end)) {
        if (b.type !== "trex") continue;
        const t = tracks.get(dv.getUint32(b.body + 4));
        if (t) t.trex = { dur: dv.getUint32(b.body + 12), size: dv.getUint32(b.body + 16), flags: dv.getUint32(b.body + 20) };
      }
    return tracks;
  }

  // The samples of one moof (file offsets, times in the track's timescale)
  function parseMoof(dv, moofPos, tracks, keep) {
    let prevEnd = moofPos;
    for (const traf of boxes(dv, 0, dv.byteLength)) {
      if (traf.type !== "traf") continue;
      const tfhd = child(dv, traf, "tfhd");
      if (!tfhd) continue;
      const tf = dv.getUint32(tfhd.body) & 0xffffff;
      const t = tracks.get(dv.getUint32(tfhd.body + 4));
      if (!t) continue;
      const def = { ...(t.trex || { dur: 0, size: 0, flags: 0 }) };
      let o = tfhd.body + 8;
      let base = tf & 0x20000 ? moofPos : prevEnd;
      if (tf & 0x1) (base = u64(dv, o)), (o += 8);
      if (tf & 0x2) o += 4;
      if (tf & 0x8) (def.dur = dv.getUint32(o)), (o += 4);
      if (tf & 0x10) (def.size = dv.getUint32(o)), (o += 4);
      if (tf & 0x20) (def.flags = dv.getUint32(o)), (o += 4);
      const tfdt = child(dv, traf, "tfdt");
      let dts = tfdt ? (dv.getUint8(tfdt.body) === 1 ? u64(dv, tfdt.body + 4) : dv.getUint32(tfdt.body + 4)) : t.next || 0;
      let pos = base;
      for (const trun of boxes(dv, traf.body, traf.end)) {
        if (trun.type !== "trun") continue;
        const v1 = dv.getUint8(trun.body) === 1;
        const rf = dv.getUint32(trun.body) & 0xffffff;
        const n = dv.getUint32(trun.body + 4);
        let p = trun.body + 8;
        if (rf & 0x1) (pos = base + dv.getInt32(p)), (p += 4);
        let first = null;
        if (rf & 0x4) (first = dv.getUint32(p)), (p += 4);
        const out = [];
        for (let i = 0; i < n; i++) {
          const dur = rf & 0x100 ? dv.getUint32((p += 4) - 4) : def.dur;
          const size = rf & 0x200 ? dv.getUint32((p += 4) - 4) : def.size;
          let flags = rf & 0x400 ? dv.getUint32((p += 4) - 4) : def.flags;
          if (i === 0 && first !== null) flags = first;
          const cto = rf & 0x800 ? (v1 ? dv.getInt32((p += 4) - 4) : dv.getUint32((p += 4) - 4)) : 0;
          out.push({ dts, cto, dur, size, pos, key: !(flags & 0x10000) });
          dts += dur;
          pos += size;
        }
        if (keep(t, out)) t.samples.push(...out);
      }
      t.next = dts;
      prevEnd = pos;
    }
  }

  // Where each fragment starts, from the mfra box at the end of a finished recording:
  // [{ time (track timescale), pos }] of the first track listed, or null
  async function fragmentTable(blob) {
    if (blob.size < 16) return null;
    const mfro = await read(blob, blob.size - 16, 16);
    if (fourcc(mfro, 4) !== "mfro") return null;
    const size = mfro.getUint32(12);
    if (size < 16 || size > blob.size) return null;
    const dv = await read(blob, blob.size - size, size);
    if (fourcc(dv, 4) !== "mfra") return null;
    for (const b of boxes(dv, 8, size)) {
      if (b.type !== "tfra") continue;
      const v1 = dv.getUint8(b.body) === 1;
      const lens = dv.getUint32(b.body + 8);
      const skip = ((lens >> 4) & 3) + ((lens >> 2) & 3) + (lens & 3) + 3;
      const n = dv.getUint32(b.body + 12);
      const out = { id: dv.getUint32(b.body + 4), list: [] };
      let o = b.body + 16;
      for (let i = 0; i < n && o + (v1 ? 16 : 8) <= b.end; i++) {
        out.list.push(v1 ? { time: u64(dv, o), pos: u64(dv, o + 8) } : { time: dv.getUint32(o), pos: dv.getUint32(o + 4) });
        o += (v1 ? 16 : 8) + skip;
      }
      return out;
    }
    return null;
  }

  // Read the parts of the file that matter for [start, end] seconds: the moov, and the moofs near the range
  async function index(blob, start, end) {
    let tracks = null;
    let pos = 0;
    // a little before the start, to find the keyframe the clip begins on
    const from = Math.max(0, start - 10);
    const keep = (t, s) => s.length && s[0].dts / t.timescale <= end && (s[s.length - 1].dts + s[s.length - 1].dur) / t.timescale >= from;
    // Box headers and moofs are read through a 64 KB window: one read per fragment, not three
    let win = null;
    let winPos = 0;
    const view = async (p, len) => {
      if (!win || p < winPos || p + len > winPos + win.byteLength) {
        winPos = p;
        win = await read(blob, p, Math.max(len, 64 << 10));
      }
      return new DataView(win.buffer, p - winPos, Math.min(len, win.byteLength - (p - winPos)));
    };
    let jumped = false;
    while (pos + 8 <= blob.size) {
      const h = await view(pos, 16);
      let size = h.getUint32(0);
      const type = fourcc(h, 4);
      const hdr = size === 1 ? 16 : 8;
      if (size === 1) size = u64(h, 8);
      else if (size === 0) size = blob.size - pos;
      if (size < hdr) break;
      if (type === "moov") {
        tracks = parseMoov(await read(blob, pos + hdr, size - hdr));
        if ([...tracks.values()].some((t) => t.flat)) return null;
      } else if (type === "moof") {
        if (!tracks) return null;
        // A finished recording lists its fragments at the end: skip straight to the ones near the start
        if (!jumped) {
          jumped = true;
          const table = await fragmentTable(blob).catch(() => null);
          const t = table && tracks.get(table.id);
          if (t) {
            const before = table.list.filter((x) => x.time / t.timescale <= from && x.pos >= pos && x.pos < blob.size).pop();
            if (before && before.pos > pos) {
              pos = before.pos;
              continue;
            }
          }
        }
        parseMoof(await view(pos + 8, size - 8), pos, tracks, keep);
        // past the end on every track: the rest of the file isn't needed
        if ([...tracks.values()].every((t) => t.next !== undefined && t.next / t.timescale > end + 1)) break;
      }
      pos += size;
    }
    if (!tracks) return null;
    const list = [...tracks.values()];
    const video = list.find((t) => t.kind === "video");
    const audio = list.find((t) => t.kind === "audio");
    if (!video && !audio) return null;
    return { video, audio };
  }

  // The clip as a normal MP4, written to the file `open()` gives (a FileSystemWritableFileStream), or
  // returned as a Blob without `open`. Returns null when the file can't be cut this way.
  async function cutMp4(blob, start, end, { open, onProgress } = {}) {
    const ix = await index(blob, start, end);
    if (!ix) return null;
    const { video, audio } = ix;
    const pts = (t, s) => (s.dts + s.cto) / t.timescale;

    // Video from the keyframe at or before the start; audio from that same moment
    let t0 = start;
    let vs = [];
    if (video) {
      const ss = video.samples;
      let k = -1;
      for (let i = 0; i < ss.length; i++) {
        if (!ss[i].key) continue;
        if (pts(video, ss[i]) <= start + 1e-6 || k < 0) k = i;
        if (pts(video, ss[i]) > start) break;
      }
      if (k < 0) throw new Error("No keyframe found in this part of the recording.");
      t0 = ss[k].dts / video.timescale;
      vs = ss.slice(k).filter((s) => pts(video, s) < end);
    }
    const as = audio ? audio.samples.filter((s) => s.dts / audio.timescale >= t0 - 1e-6 && s.dts / audio.timescale < end) : [];
    if (!vs.length && !as.length) throw new Error("This part of the recording is empty.");

    // Both tracks in time order, so the new file is interleaved like the original
    const items = [...vs.map((s) => ({ t: video, s, at: s.dts / video.timescale })), ...as.map((s) => ({ t: audio, s, at: s.dts / audio.timescale }))].sort(
      (a, b) => a.at - b.at || (a.t === video ? -1 : 1)
    );

    const writable = open ? await open() : null;
    try {
      return await mux(blob, items, video, audio, vs.length, as.length, t0, writable, onProgress);
    } catch (e) {
      if (writable) await writable.abort().catch(() => {});
      throw e;
    }
  }

  async function mux(blob, items, video, audio, nv, na, t0, writable, onProgress) {
    const target = writable ? new Mp4Muxer.FileSystemWritableFileStreamTarget(writable) : new Mp4Muxer.ArrayBufferTarget();
    const muxer = new Mp4Muxer.Muxer({
      target,
      ...(nv ? { video: { codec: "avc", width: video.width, height: video.height } } : {}),
      ...(na ? { audio: { codec: audio.codec, numberOfChannels: audio.channels, sampleRate: audio.sampleRate } } : {}),
      fastStart: { expectedVideoChunks: nv, expectedAudioChunks: na },
      firstTimestampBehavior: "cross-track-offset",
    });

    const us = (ticks, t) => (ticks / t.timescale) * 1e6;
    const base = t0 * 1e6;
    let vFirst = true;
    let aFirst = true;
    // Read the sample data in windows of a few MB (never the whole recording)
    const WINDOW = 8 << 20;
    for (let i = 0; i < items.length; ) {
      let lo = items[i].s.pos;
      let hi = lo + items[i].s.size;
      let j = i + 1;
      while (j < items.length) {
        const s = items[j].s;
        const nlo = Math.min(lo, s.pos);
        const nhi = Math.max(hi, s.pos + s.size);
        if (nhi - nlo > WINDOW) break;
        lo = nlo;
        hi = nhi;
        j++;
      }
      const buf = new Uint8Array(await blob.slice(lo, hi).arrayBuffer());
      for (; i < j; i++) {
        const { t, s } = items[i];
        const data = buf.subarray(s.pos - lo, s.pos - lo + s.size);
        const ts = Math.max(0, us(s.dts + s.cto, t) - base);
        if (t === video) {
          muxer.addVideoChunkRaw(data, s.key ? "key" : "delta", ts, us(s.dur, t), vFirst ? { decoderConfig: video.config } : undefined, us(s.cto, t));
          vFirst = false;
        } else {
          muxer.addAudioChunkRaw(data, "key", ts, us(s.dur, t), aFirst ? { decoderConfig: audio.config } : undefined);
          aFirst = false;
        }
      }
      if (onProgress) onProgress(i / items.length);
      await new Promise((r) => setTimeout(r)); // keep the page responsive
    }
    muxer.finalize();
    if (writable) await writable.close();
    return { blob: writable ? null : new Blob([target.buffer], { type: "video/mp4" }), start: t0 };
  }

  // What recordAgain() makes: MP4 where this Chrome's MediaRecorder can, else WebM
  const MP4_TYPES = ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4;codecs=avc1,mp4a.40.2", "video/mp4"];
  const WEBM_TYPES = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  const supported = (list) => (typeof MediaRecorder !== "undefined" ? list.find((t) => MediaRecorder.isTypeSupported(t)) : null);
  const againExt = () => (supported(MP4_TYPES) ? "mp4" : "webm");

  // Play [start, end] in a hidden player and record it again (WebM, or MP4 files that can't be cut)
  async function recordAgain(blob, start, end, { onProgress, signal } = {}) {
    const url = URL.createObjectURL(blob);
    const v = document.createElement("video");
    v.style.cssText = "position:fixed;left:-10px;top:-10px;width:2px;height:2px;opacity:0;pointer-events:none";
    v.playsInline = true;
    v.src = url;
    document.body.append(v);
    let ac = null;
    try {
      await new Promise((res, rej) => {
        v.onloadedmetadata = res;
        v.onerror = () => rej(new Error("This recording can't be played in the browser."));
      });
      // The sound goes to the recorder only (through Web Audio), not to the speakers
      ac = new AudioContext();
      const dest = ac.createMediaStreamDestination();
      ac.createMediaElementSource(v).connect(dest);
      v.currentTime = start;
      await new Promise((r) => (v.onseeked = r));
      const stream = new MediaStream([...v.captureStream().getVideoTracks(), ...dest.stream.getAudioTracks()]);
      const mimeType = supported(MP4_TYPES) || supported(WEBM_TYPES);
      const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const stopped = new Promise((r) => (rec.onstop = r));
      rec.start(1000);
      await ac.resume();
      await v.play();
      await new Promise((res) => {
        const tick = () => {
          if (signal && signal.aborted) return res();
          if (onProgress) onProgress(Math.min(1, (v.currentTime - start) / (end - start)));
          if (v.currentTime >= end || v.ended) return res();
          setTimeout(tick, 100);
        };
        tick();
      });
      v.pause();
      rec.stop();
      await stopped;
      stream.getTracks().forEach((t) => t.stop());
      if (signal && signal.aborted) throw new DOMException("Cancelled", "AbortError");
      const mp4 = mimeType.startsWith("video/mp4");
      let out = new Blob(chunks, { type: mp4 ? "video/mp4" : "video/webm" });
      if (!mp4)
        try {
          out = await fixWebm(out); // duration + seek index
        } catch {}
      return { blob: out, start, end: Math.min(end, v.currentTime) };
    } finally {
      if (ac) ac.close().catch(() => {});
      v.remove();
      URL.revokeObjectURL(url);
    }
  }

  return { cutMp4, recordAgain, againExt };
})();
