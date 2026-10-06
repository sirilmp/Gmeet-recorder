// Kept modest on purpose: long recordings must not load the CPU/RAM
const QUALITY = {
  low: { w: 640, h: 360, fps: 8, vbps: 300_000 }, // slowest PCs, smallest files
  light: { w: 960, h: 540, fps: 10, vbps: 600_000 }, // for slower PCs
  standard: { w: 1280, h: 720, fps: 15, vbps: 1_200_000 },
  high: { w: 1920, h: 1080, fps: 20, vbps: 2_500_000 }, // sharpest, most CPU and disk
  ultra: { w: 2560, h: 1440, fps: 24, vbps: 5_000_000 }, // needs a strong PC (hardware H.264)
  max: { w: 3840, h: 2160, fps: 30, vbps: 12_000_000 }, // 4K: hardware encoder only
};
let W = 1280;
let H = 720;
let FPS = 15;
let VBPS = 1_200_000;

// Chunks are written to disk (browser-private storage) while recording instead of piling up in RAM
let fileHandle = null;
let writable = null;
let engine = null;
let fileExt = "webm";
let statsTimer = null;
let writeChain = Promise.resolve();
let fileName = "";
let totalSize = 0;

let shareLiveReported = false;
let mixDest = null; // audio mix that goes into the recording
let shareAudioEl = null;
let shareAudioNode = null;
let tabOutEl = null; // plays the meeting sound to my speakers/headset while recording
let tabOutCtx = null; // fallback for the above

// Loudness meters (peak 0..1) so the popup can show whether a source is really producing sound
let levelTimers = [];
function watchLevel(key, source) {
  const an = audioCtx.createAnalyser();
  an.fftSize = 1024;
  source.connect(an);
  const buf = new Float32Array(an.fftSize);
  let peak = 0;
  let last = -1;
  const sample = setInterval(() => {
    an.getFloatTimeDomainData(buf);
    for (let i = 0; i < buf.length; i += 4) peak = Math.max(peak, Math.abs(buf[i]));
  }, 250);
  const report = setInterval(() => {
    const v = Math.round(peak * 20) / 20; // coarse steps, so most reports are skipped
    if (v !== last) diag({ [key]: v });
    last = v;
    peak = 0;
  }, 2000);
  levelTimers.push(sample, report);
  return [sample, report];
}

// ---------- microphone (can be switched while recording)
let micDest = null; // the recording's audio mix
let micStream = null;
let micSource = null;
let micTimers = [];
let micAuto = true; // follow the mic Google Meet uses
let micGain = null; // silences my mic while I'm muted in Meet
let meetMuted = false;
let meetMicLabel = null; // last mic label reported by the Meet page

async function findMicByLabel(label) {
  const mics = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
  const bare = (l) => l.replace(/^(Default|Communications) - /, "");
  const hit = mics.find((d) => d.label === label) || mics.find((d) => bare(d.label) === bare(label));
  return hit ? hit.deviceId : null;
}

// Open a mic and put it into the recording in place of the current one. deviceId null = system default.
async function useMicDevice(deviceId) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: deviceId ? { deviceId: { exact: deviceId } } : true,
  });
  // swap: the recording keeps running, only its mic input changes
  if (micSource) micSource.disconnect();
  if (micGain) micGain.disconnect();
  if (micStream) micStream.getTracks().forEach((t) => t.stop());
  micTimers.forEach(clearInterval);
  streams = streams.filter((s) => s !== micStream);
  micStream = stream;
  streams.push(stream);
  micSource = audioCtx.createMediaStreamSource(stream);
  micGain = audioCtx.createGain();
  micGain.gain.value = meetMuted ? 0 : 1;
  micSource.connect(micGain);
  micGain.connect(micDest);
  micTimers = watchLevel("micLevel", micGain);
  const t = stream.getAudioTracks()[0];
  diag({ mic: "on", micName: t ? t.label : "", micAuto });
}

// Called when Meet reports its mic, or the popup picks one
async function switchMic(micId) {
  if (!recorder || !micDest) return;
  micAuto = !micId || micId === "auto";
  try {
    if (micAuto) {
      const id = meetMicLabel ? await findMicByLabel(meetMicLabel) : null;
      await useMicDevice(id);
    } else {
      await useMicDevice(micId);
    }
  } catch (e) {
    console.warn("Mic switch failed", e);
    diag({ mic: `FAILED to switch mic (${e.name})` });
  }
}

// ---------- speaker the meeting sound is played to (follows Meet's speaker setting)
let meetSpeakerLabel = ""; // "" = system default

async function applySpeaker() {
  const out = tabOutEl || tabOutCtx;
  if (!out || typeof out.setSinkId !== "function") return;
  let id = "";
  if (meetSpeakerLabel) {
    try {
      const bare = (l) => l.replace(/^(Default|Communications) - /, "");
      const outs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audiooutput");
      const hit =
        outs.find((d) => d.label === meetSpeakerLabel) || outs.find((d) => bare(d.label) === bare(meetSpeakerLabel));
      id = hit ? hit.deviceId : "";
    } catch {
      /* system default */
    }
  }
  try {
    if (out.sinkId !== id) await out.setSinkId(id);
    diag({ output: id ? meetSpeakerLabel : "default" });
  } catch (e) {
    console.warn("Could not play the meeting sound on", meetSpeakerLabel, e);
    diag({ output: `FAILED (${e.name}), using default` });
  }
}
// A Bluetooth headset reconnecting or switching to its call mode can change its device ids
navigator.mediaDevices.addEventListener("devicechange", () => applySpeaker());

// Live status shown in the popup (mic / audio engine / screen share)
function diag(patch) {
  chrome.runtime.sendMessage({ target: "background", type: "diag", patch }).catch(() => {});
}

let recorder = null;
let chunks = [];
let audioCtx = null;
let streams = [];
let startedAt = 0;

// Tab mode composes frames on a canvas so my own shared screen can be shown when I present
let ticker = null;
let ctx2d = null;
let tabVideo = null;
let shareVideo = null;
let shareActive = false;
let sharePc = null;
let presentVideo = null; // whole screen picked at start (used while I'm presenting)
let presenting = false; // Meet says I'm presenting
let pendingIce = [];

function makeVideo(stream) {
  const v = document.createElement("video");
  v.muted = true;
  v.playsInline = true;
  if (stream) {
    v.srcObject = stream;
    v.play().catch(() => {});
  }
  return v;
}

function contain(video, x, y, w, h) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;
  const s = Math.min(w / vw, h / vh);
  const dw = vw * s;
  const dh = vh * s;
  ctx2d.drawImage(video, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function draw() {
  ctx2d.fillStyle = "#000";
  ctx2d.fillRect(0, 0, W, H);
  const loop = shareActive && shareVideo.videoWidth > 0 ? shareVideo : null;
  const screen = !loop && presenting && presentVideo && presentVideo.videoWidth > 0 ? presentVideo : null;
  const mine = loop || screen;
  if (mine) {
    if (!shareLiveReported) {
      shareLiveReported = true;
      diag({ share: "live" });
    }
    contain(mine, 0, 0, W, H); // my shared screen, full size
    const pw = 256;
    const ph = 144;
    const px = W - pw - 24;
    const py = H - ph - 24;
    ctx2d.fillRect(px - 2, py - 2, pw + 4, ph + 4);
    contain(tabVideo, px, py, pw, ph); // the meeting, small in the corner
  } else {
    contain(tabVideo, 0, 0, W, H);
  }
}

// The whole-screen capture idles at 1 fps until I present (saves a lot of CPU)
function setPresentRate() {
  const t = presentVideo && presentVideo.srcObject && presentVideo.srcObject.getVideoTracks()[0];
  if (!t) return;
  t.applyConstraints({ frameRate: { max: presenting ? FPS : 1 } }).catch(() => {});
}

// ---------- receiving my screen share from the Meet page (WebRTC loopback) ----------
function relay(tabId, msg) {
  chrome.runtime.sendMessage({ target: "background", type: "relay", tabId, msg }).catch(() => {});
}

// Sound of the video I play while presenting -> into the recording only (I already hear it locally)
function attachShareAudio(track) {
  if (!audioCtx || !mixDest) return;
  const ms = new MediaStream([track]);
  // Chrome only delivers remote WebRTC audio to WebAudio if it is also attached to a media element
  shareAudioEl = new Audio();
  shareAudioEl.muted = true;
  shareAudioEl.srcObject = ms;
  shareAudioEl.play().catch(() => {});
  shareAudioNode = audioCtx.createMediaStreamSource(ms);
  shareAudioNode.connect(mixDest);
  diag({ shareAudio: "on" });
}

function closeSharePc() {
  if (shareAudioNode) shareAudioNode.disconnect();
  shareAudioNode = null;
  if (shareAudioEl) shareAudioEl.srcObject = null;
  shareAudioEl = null;
  if (sharePc) {
    sharePc.close();
    sharePc = null;
  }
  pendingIce = [];
  shareActive = false;
  if (shareVideo) shareVideo.srcObject = null;
}

async function onShareSignal(m, tabId) {
  if (m.kind === "meet-muted") {
    // Muted in Meet: nothing of my mic goes into the recording
    meetMuted = m.muted;
    diag({ micMuted: m.muted });
    if (micGain) micGain.gain.value = meetMuted ? 0 : 1;
    return;
  }
  if (m.kind === "meet-speaker") {
    // Meet plays the call to this speaker: play the meeting sound there too ("" = system default)
    meetSpeakerLabel = m.label || "";
    applySpeaker();
    return;
  }
  if (m.kind === "meet-mic") {
    // Meet opened (or switched to) this mic: follow it when on Auto
    if (!m.label) return;
    meetMicLabel = m.label;
    const bare = (l) => (l || "").replace(/^(Default|Communications) - /, "");
    const current = micStream && micStream.getAudioTracks()[0];
    if (recorder && micDest && micAuto && (!current || bare(current.label) !== bare(m.label))) await switchMic("auto");
    return;
  }
  if (!recorder || !shareVideo || tabId == null) return; // only while recording in tab mode
  if (m.kind === "hook-ready") {
    diag({ hook: "ready" });
  } else if (m.kind === "presenting") {
    // From the Meet page UI ("Stop presenting" button visible or not)
    if (m.on !== presenting) {
      presenting = m.on;
      setPresentRate();
      shareLiveReported = false;
      if (!m.on && !shareActive) diag({ share: "ended" });
      else if (m.on) diag({ share: "detected" });
    }
  } else if (m.kind === "share-detected") {
    presenting = true;
    setPresentRate();
    diag({ share: "detected", shareAudio: m.audio ? "pending" : "none" });
  } else if (m.kind === "offer") {
    closeSharePc();
    shareLiveReported = false;
    diag({ share: "connecting" });
    const pc = (sharePc = new RTCPeerConnection({ iceServers: [] }));
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") diag({ share: "FAILED: could not connect to the Meet page" });
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) relay(tabId, { kind: "ice", candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      if (e.track.kind === "audio") {
        attachShareAudio(e.track);
        return;
      }
      shareVideo.srcObject = new MediaStream([e.track]);
      shareVideo.play().catch(() => {});
      shareActive = true;
    };
    await pc.setRemoteDescription({ type: "offer", sdp: m.sdp });
    for (const c of pendingIce) await pc.addIceCandidate(c).catch(() => {});
    pendingIce = [];
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    relay(tabId, { kind: "answer", sdp: answer.sdp });
  } else if (m.kind === "ice") {
    if (sharePc && sharePc.remoteDescription) await sharePc.addIceCandidate(m.candidate).catch(() => {});
    else pendingIce.push(m.candidate);
  } else if (m.kind === "share-stop") {
    presenting = false;
    setPresentRate();
    closeSharePc();
    diag({ share: "ended" });
  }
}

// ---------- recording ----------
async function startRecording(streamId, desktopStreamId, useMic, desktopAudio, micId, presentStreamId, quality) {
  if (recorder) throw new Error("Already recording.");
  const q = QUALITY[quality] || QUALITY.standard;
  W = q.w;
  H = q.h;
  FPS = q.fps;
  VBPS = q.vbps;
  const screenMode = !!desktopStreamId;
  const tabConstraint = { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } };
  // Capture the tab at the recording size, not at full screen resolution / 30 fps
  const tabVideoConstraint = {
    mandatory: { ...tabConstraint.mandatory, maxWidth: W, maxHeight: H, maxFrameRate: FPS },
  };

  // Meet tab: audio of all remote participants + the tab's video
  const tabStream = await navigator.mediaDevices.getUserMedia({
    audio: tabConstraint,
    video: screenMode ? false : tabVideoConstraint,
  });
  streams = [tabStream];

  let videoTrack;
  let systemAudioTracks = [];
  if (screenMode) {
    // Screen mode: video of the chosen screen/window (+ its system audio if "Share system audio" was ticked)
    const screenStream = await navigator.mediaDevices.getUserMedia({
      audio: desktopAudio
        ? { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: desktopStreamId } }
        : false,
      video: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: desktopStreamId,
          maxWidth: W,
          maxHeight: H,
          maxFrameRate: FPS,
        },
      },
    });
    streams.push(screenStream);
    videoTrack = screenStream.getVideoTracks()[0];
    systemAudioTracks = screenStream.getAudioTracks();
  } else {
    // Tab mode: canvas shows the meeting, or my shared screen while I present
    tabVideo = makeVideo(new MediaStream(tabStream.getVideoTracks()));
    shareVideo = makeVideo(null);
    presenting = false;
    if (presentStreamId) {
      // Video only: system audio of the whole screen would duplicate the meeting sound
      const presentStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: presentStreamId,
            maxWidth: W,
            maxHeight: H,
            maxFrameRate: FPS,
          },
        },
      });
      streams.push(presentStream);
      presentVideo = makeVideo(presentStream);
      setPresentRate(); // idle at 1 fps until I present
      diag({ presentScreen: "ready" });
    }
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    ctx2d = canvas.getContext("2d", { alpha: false, desynchronized: true });
    ticker = new Worker("ticker.js");
    ticker.postMessage(Math.round(1000 / FPS));
    ticker.onmessage = draw;
    videoTrack = canvas.captureStream(FPS).getVideoTracks()[0];
    tabStream.getVideoTracks()[0].addEventListener("ended", stopRecording);
  }

  // The recording's audio mix runs on Chrome's own clock, not on the speakers/headset. A Web Audio
  // graph is otherwise driven by the output device, and Bluetooth headsets are a poor clock: once a
  // mic is open they drop to their call mode (mono, 16 kHz, uneven callbacks), and every hiccup there
  // became a crackle or a stall in both what I hear and what gets recorded.
  // The meeting sound I listen to is played separately by a plain <audio> element (below), the same
  // path Meet itself uses, which copes with Bluetooth call mode and device switches.
  const silentSink = typeof AudioContext.prototype.setSinkId === "function";
  try {
    audioCtx = silentSink
      ? new AudioContext({ sinkId: { type: "none" }, sampleRate: 48000 })
      : new AudioContext({ latencyHint: "playback", sampleRate: 48000 });
  } catch {
    audioCtx = new AudioContext({ latencyHint: "playback" });
  }
  // A hidden page can start with a suspended audio engine, which records silence
  await audioCtx.resume().catch(() => {});
  diag({ audio: audioCtx.state });
  const dest = audioCtx.createMediaStreamDestination();
  mixDest = dest;

  if (screenMode) {
    if (systemAudioTracks.length) {
      audioCtx.createMediaStreamSource(new MediaStream(systemAudioTracks)).connect(dest);
      diag({ shareAudio: "on" });
    } else {
      diag({ shareAudio: "none" });
    }
  }

  // Tab audio -> recording AND speakers (capturing a tab mutes it otherwise)
  const tabSource = audioCtx.createMediaStreamSource(tabStream);
  tabSource.connect(dest);
  watchLevel("tabLevel", tabSource);
  if (silentSink && tabStream.getAudioTracks().length) {
    tabOutEl = new Audio();
    tabOutEl.srcObject = new MediaStream(tabStream.getAudioTracks());
    applySpeaker();
    tabOutEl.play().catch((e) => {
      // Shouldn't happen on an extension page; if it does, play through Web Audio as before
      console.warn("Meeting sound playback failed, using Web Audio:", e);
      tabOutEl = null;
      tabOutCtx = new AudioContext({ latencyHint: "playback" });
      tabOutCtx.createMediaStreamSource(tabStream).connect(tabOutCtx.destination);
      tabOutCtx.resume().catch(() => {});
      applySpeaker();
    });
  } else {
    tabSource.connect(audioCtx.destination);
  }

  // Your own voice -> recording only (not to speakers, avoids echo)
  micDest = null;
  micStream = null;
  micSource = null;
  micGain = null;
  meetMuted = false;
  micTimers = [];
  if (useMic) {
    micDest = dest;
    micAuto = !micId || micId === "auto";
    try {
      // Auto: start with Meet's mic if already known, else the system default; the Meet page
      // reports its mic right after the start and we switch to it then.
      let id = micAuto ? (meetMicLabel ? await findMicByLabel(meetMicLabel) : null) : micId;
      try {
        await useMicDevice(id);
      } catch (e) {
        if (!id) throw e;
        await useMicDevice(null); // chosen mic unplugged
      }
    } catch (e) {
      console.warn("Mic unavailable, recording tab audio only:", e);
      diag({ mic: `FAILED (${e.name}). Use "Allow microphone access" in the popup, then record again.` });
    }
  } else {
    diag({ mic: "off" });
  }

  const finalStream = new MediaStream([videoTrack, ...dest.stream.getAudioTracks()]);

  // H.264 is hardware-encoded on most PCs (far lighter than VP9/VP8 in software)
  const mimeType = ["video/webm;codecs=h264,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((t) =>
    MediaRecorder.isTypeSupported(t)
  );

  chunks = [];
  totalSize = 0;
  writable = null;
  writeChain = Promise.resolve();
  try {
    const root = await navigator.storage.getDirectory();
    fileName = `rec-${Date.now()}.webm`;
    fileHandle = await root.getFileHandle(fileName, { create: true });
    writable = await fileHandle.createWritable();
  } catch (e) {
    console.warn("Disk buffering unavailable, keeping the recording in memory:", e);
    writable = null;
  }

  // Preferred: hardware encoder straight into a fragmented MP4 on disk (light on CPU/RAM, any resolution)
  fileExt = "webm";
  engine = null;
  if (writable && MeetEngine.supported()) {
    try {
      const old = fileName;
      const mp4Name = fileName.replace(/\.webm$/, ".mp4");
      // Fresh file for the engine; the unused .webm one is dropped
      await writable.close().catch(() => {});
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(old).catch(() => {});
      fileName = mp4Name;
      fileHandle = await root.getFileHandle(fileName, { create: true });
      writable = await fileHandle.createWritable();
      engine = await MeetEngine.create({
        videoTrack,
        audioTrack: dest.stream.getAudioTracks()[0],
        writable,
        fps: FPS,
        vbps: VBPS,
        abps: 96_000,
        sampleRate: audioCtx.sampleRate,
        channels: 2,
      });
      fileExt = "mp4";
      const s = engine.stats();
      diag({ engine: `${s.hardware ? "GPU" : "CPU"} ${s.w}x${s.h} · clock-fix` });
    } catch (e) {
      console.warn("WebCodecs engine unavailable, using MediaRecorder:", e);
      diag({ engine: "fallback" });
      engine = null;
      try {
        await writable.close();
      } catch {}
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(fileName).catch(() => {});
      fileName = `rec-${Date.now()}.webm`;
      fileHandle = await root.getFileHandle(fileName, { create: true });
      writable = await fileHandle.createWritable();
    }
  }
  if (engine) {
    const eng = engine;
    recorder = {
      state: "recording",
      stop() {
        this.state = "inactive";
        eng.stop().then(finish, async (err) => {
          console.warn("engine stop failed", err);
          try {
            await writable.close(); // keep whatever was written
          } catch {}
          engine = null;
          finish();
        });
      },
    };
    watchDisk();
    startedAt = Date.now();
    videoTrack.addEventListener("ended", stopRecording);
    tabStream.getAudioTracks().forEach((t) => t.addEventListener("ended", stopRecording));
    // The engine failing mid-recording (encoder error): save what we have
    statsTimer = setInterval(() => {
      const st = eng.stats();
      diag({ encoder: { frames: st.frames, dropped: st.dropped, queue: st.queue } });
      if (st.failed) stopRecording();
    }, 5000);
    return;
  }

  recorder = new MediaRecorder(finalStream, {
    mimeType,
    videoBitsPerSecond: VBPS,
    audioBitsPerSecond: 96_000,
  });
  recorder.ondataavailable = (e) => {
    if (!e.data || !e.data.size) return;
    totalSize += e.data.size;
    if (writable) {
      const w = writable;
      writeChain = writeChain.then(() => w.write(e.data)).catch((err) => console.warn("write failed", err));
    } else {
      chunks.push(e.data);
    }
  };
  recorder.onstop = finish;
  recorder.start(5000);
  watchDisk();
  startedAt = Date.now();

  // Stop cleanly (and still save) if the user clicks Chrome's "Stop sharing" or the Meet tab closes
  videoTrack.addEventListener("ended", stopRecording);
  tabStream.getAudioTracks().forEach((t) => t.addEventListener("ended", stopRecording));
}

// Stop and save cleanly before the disk fills up (a full disk corrupts the file and can crash the browser)
const MIN_FREE = 600 * 1024 * 1024;
let diskTimer = null;
function watchDisk() {
  clearInterval(diskTimer);
  diskTimer = setInterval(async () => {
    try {
      const { quota, usage } = await navigator.storage.estimate();
      const free = quota - usage;
      if (free < MIN_FREE * 2) diag({ disk: "low" });
      if (free < MIN_FREE) {
        diag({ disk: "full" });
        stopRecording();
      }
    } catch {}
  }, 20_000);
}

function stopRecording() {
  if (recorder && recorder.state !== "inactive") recorder.stop();
}

function cleanup() {
  clearInterval(diskTimer);
  clearInterval(statsTimer);
  levelTimers.forEach(clearInterval);
  levelTimers = [];
  streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  streams = [];
  if (ticker) ticker.terminate();
  ticker = null;
  closeSharePc();
  tabVideo = null;
  shareVideo = null;
  presentVideo = null;
  presenting = false;
  ctx2d = null;
  if (tabOutEl) tabOutEl.srcObject = null;
  tabOutEl = null;
  if (tabOutCtx) tabOutCtx.close();
  tabOutCtx = null;
  if (audioCtx) audioCtx.close();
  audioCtx = null;
  mixDest = null;
  recorder = null;
  engine = null;
  chunks = [];
}

// Upload the finished recording to the user's Drive (through their saved script):
// Meet Recordings / <date> / <recording> / video + info file (bookmarks; the transcript comes later)
async function autoUpload(blob, filename, startedAtMs, rec) {
  const bg = (msg) => chrome.runtime.sendMessage({ target: "background", ...msg }).catch(() => null);
  const status = (patch) => bg({ type: "upload-status", patch });
  try {
    status({ state: "uploading", pct: 0 });
    const { driveConn: conn } = await chrome.storage.local.get("driveConn");
    if (!conn || !conn.url) throw new Error("Google Drive is not connected. Connect it in the library.");
    const d = new Date(startedAtMs);
    const p = (n) => String(n).padStart(2, "0");
    const dateName = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    const oldUrl = conn.url;
    const driveName = filename.split("/").pop();
    const out = await driveUploadPackage(conn, blob, rec || { name: driveName, startedAt: startedAtMs }, driveName, dateName, null, (pct) =>
      status({ state: "uploading", pct })
    );
    if (conn.url !== oldUrl) await chrome.storage.local.set({ driveConn: conn });
    await bg({
      type: "uploaded",
      startedAt: startedAtMs,
      fileUrl: out.fileUrl,
      folderUrl: out.folderUrl,
      folderId: out.folderId,
      packaged: out.packaged,
      driveName,
    });
    status({ state: "done", shared: true, ...out });
  } catch (e) {
    console.warn("auto-upload failed", e);
    status({ state: "error", error: e.message });
  }
}

// Streams the finished file into the extension's private storage as keep-<startedAt>.<ext>
async function keepCopy(blob, startedAtMs) {
  const root = await navigator.storage.getDirectory();
  const name = `keep-${startedAtMs}.${fileExt}`;
  try {
    const h = await root.getFileHandle(name, { create: true });
    const w = await h.createWritable();
    await blob.stream().pipeTo(w); // closes the file when done
    return new Blob([await h.getFile()], { type: `video/${fileExt}` });
  } catch (e) {
    await root.removeEntry(name).catch(() => {});
    throw e;
  }
}

async function finish() {
  try {
    const durationMs = Date.now() - startedAt;
    let blob;
    let stored = null;
    if (writable) {
      await writeChain;
      if (!engine) await writable.close(); // the engine closes its own file
      writable = null;
      // disk-backed, not loaded into RAM; the type is needed for the Drive upload
      blob = new Blob([await fileHandle.getFile()], { type: `video/${fileExt}` });
      stored = fileName;
    } else {
      blob = new Blob(chunks, { type: "video/webm" });
      fileExt = "webm";
    }
    cleanup();

    // Add duration + seek index so players show the time and can fast-forward
    if (blob.size && fileExt === "webm") {
      try {
        blob = await fixWebm(blob);
      } catch (e) {
        console.warn("webm fix skipped", e);
      }
    }

    if (!blob.size) {
      chrome.runtime.sendMessage({ target: "background", type: "stopped" });
      return;
    }
    // Ask the background for the file name, then download here; the background files it into
    // Downloads/MeetRecordings and adds it to the list (via onDeterminingFilename).
    const res = await chrome.runtime.sendMessage({
      target: "background",
      type: "saving",
      durationMs,
      size: blob.size,
      ext: fileExt,
    });
    // Keep a copy inside the extension so the library can upload it later without asking
    // for the file. The download is made from that copy, so the raw buffer can go right away.
    let kept = null;
    if (res && res.startedAt) {
      try {
        kept = await keepCopy(blob, res.startedAt);
        blob = kept;
      } catch (e) {
        console.warn("Could not keep a copy for uploads:", e);
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (res && res.filename) || `meet-recording.${fileExt}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    const root = await navigator.storage.getDirectory();
    if (kept && stored) await root.removeEntry(stored).catch(() => {});
    const uploadDone = res && res.autoUpload ? autoUpload(blob, res.filename, res.startedAt, res.rec) : Promise.resolve();
    setTimeout(async () => {
      await uploadDone; // keep the file until the Drive upload has read it
      URL.revokeObjectURL(url);
      if (stored && !kept) await root.removeEntry(stored).catch(() => {});
    }, 10 * 60_000);
  } catch (e) {
    console.error("finish failed", e);
    cleanup();
    chrome.runtime.sendMessage({ target: "background", type: "stopped", error: e.message });
  } finally {
    Transcriber.resume(); // the background queues the new recording; this picks it up
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== "offscreen") return;
  if (msg.type === "start") {
    Transcriber.pause(); // the recording gets the whole CPU; transcripts carry on after it is saved
    startRecording(msg.streamId, msg.desktopStreamId, msg.useMic, msg.desktopAudio, msg.micId, msg.presentStreamId, msg.quality)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => {
        cleanup();
        Transcriber.resume();
        sendResponse({ ok: false, error: e.message });
      });
    return true;
  }
  if (msg.type === "set-mic") {
    switchMic(msg.micId).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === "stop") {
    stopRecording();
    sendResponse({ ok: true });
  }
  if (msg.type === "share-signal") {
    onShareSignal(msg.msg, sender.tab && sender.tab.id).catch((e) => console.warn("share signal", e));
  }
});
