// Makes transcripts in the background, one recording at a time, inside the recorder's offscreen page
// (so it keeps going with the library closed). The background worker owns the queue and the saved
// progress; this page asks it for the next job, reads the sound a piece at a time (audio-pieces.js),
// sends 30 s slices to the speech model (transcribe-worker.js) and reports after every slice, so an
// interrupted job picks up where it stopped. It pauses while a recording is running.

const Transcriber = (() => {
const SLICE = 30; // seconds per Whisper window
const RATE = AudioPieces.RATE;
const MAX_GAP = 60 * RATE; // a bigger jump in the timestamps is treated as damage, not silence

let paused = false;
let running = false;
let current = null; // id (startedAt) of the recording being transcribed
let stopWhy = null; // "pause" | "cancel" while stopping the current job

const bg = (msg) => chrome.runtime.sendMessage({ target: "background", ...msg }).catch(() => null);

// ---------- speech model worker ----------
let worker = null;
let workerModel = null; // model the worker has loaded
let onDownload = null;
const calls = new Map();
let seq = 0;

function killWorker(why) {
  if (worker) worker.terminate();
  worker = null;
  workerModel = null;
  for (const c of calls.values()) c.reject(new Error(why || "stopped"));
  calls.clear();
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker("transcribe-worker.js", { type: "module" });
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === "download") return onDownload && onDownload(m);
    const c = calls.get(m.id);
    if (!c) return;
    calls.delete(m.id);
    if (m.type === "error") c.reject(new Error(m.message));
    else c.resolve(m.segments);
  };
  worker.onerror = (e) => {
    e.preventDefault();
    killWorker((e && e.message) || "the speech engine could not start");
  };
  return worker;
}

function transcribeSlice(audio, offset, job) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    calls.set(id, { resolve, reject });
    getWorker().postMessage({ type: "slice", id, audio, offset, model: job.model, language: job.lang }, [audio.buffer]);
  });
}

// ---------- one recording ----------
async function sourceFile(job) {
  const root = await navigator.storage.getDirectory();
  // keep-* is the copy the recorder keeps; trsrc-* is one the library made for an older recording
  for (const name of [`keep-${job.id}.${job.ext}`, `trsrc-${job.id}.${job.ext}`]) {
    try {
      const f = await (await root.getFileHandle(name)).getFile();
      if (f.size) return f;
    } catch {}
  }
  throw new Error("The video isn't kept inside the extension any more. Open it in the library and press Generate transcript.");
}

async function dropSource(job) {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(`trsrc-${job.id}.${job.ext}`);
  } catch {}
}

async function run(job) {
  const total = job.durationSec || 0;
  let segments = job.segments || [];
  let next = Math.floor((job.doneSec || 0) / SLICE); // next slice to transcribe
  const pct = () => (total ? Math.min(99, Math.round(((next * SLICE) / total) * 100)) : 0);
  const check = () => {
    if (stopWhy) throw new Error(stopWhy);
  };
  const state = (phase, text, p = pct()) => bg({ type: "tr-state", id: job.id, phase, text, pct: p });

  let lastPct = -1;
  onDownload = (m) => {
    const p = m.total ? Math.round((m.loaded / m.total) * 100) : 0;
    if (p === lastPct || p >= 100) return; // cached files report 100% at once: nothing to show
    lastPct = p;
    state("model", `Downloading the speech model (once)… ${p}%`, p);
  };

  state("reading", next ? `Picking up at ${Math.round(pct())}%…` : "Reading the audio…");
  const file = await sourceFile(job);
  check();

  const slice = async (part) => {
    if (workerModel !== job.model) state("model", "Loading the speech model…");
    const out = await transcribeSlice(part, next * SLICE, job);
    workerModel = job.model;
    check();
    segments = segments.concat(out);
    next++;
    await bg({ type: "tr-progress", id: job.id, doneSec: next * SLICE, segments, pct: pct() });
  };

  let buf = new Float32Array(0);
  let bufAt = next * SLICE * RATE; // sample position of buf[0] in the recording
  for await (const { t, pcm } of AudioPieces.pieces(file, job.ext, next * SLICE)) {
    check();
    // place the piece on the timeline: drop what is already covered, fill a small gap with silence
    let at = Math.round(t * RATE);
    const end = bufAt + buf.length;
    let data = pcm;
    if (at < end) {
      data = data.subarray(Math.min(data.length, end - at));
      at = end;
    } else if (at - end > MAX_GAP) at = end;
    const grown = new Float32Array(at - bufAt + data.length);
    grown.set(buf);
    grown.set(data, at - bufAt);
    buf = grown;
    while (buf.length >= SLICE * RATE) {
      await slice(buf.slice(0, SLICE * RATE));
      buf = buf.subarray(SLICE * RATE);
      bufAt += SLICE * RATE;
    }
  }
  if (buf.length) await slice(buf.slice());
  return segments;
}

// ---------- queue ----------
async function pump() {
  if (running || paused) return;
  running = true;
  try {
    for (;;) {
      const job = paused ? null : await bg({ type: "tr-next" });
      if (!job || !job.id || paused) break;
      current = job.id;
      stopWhy = null;
      try {
        const segments = await run(job);
        await bg({ type: "tr-done", id: job.id, segments });
        await dropSource(job);
      } catch (e) {
        if (stopWhy === "pause") break;
        if (stopWhy !== "cancel") {
          console.warn("transcript failed", e);
          await bg({ type: "tr-failed", id: job.id, error: (e && e.message) || String(e) });
        }
        await dropSource(job);
      } finally {
        current = null;
        onDownload = null;
      }
    }
  } finally {
    running = false;
    if (!paused) killWorker(); // frees the speech model's memory until it is needed again
  }
}

// A recording is starting: stop at once, so it gets the whole CPU. Progress up to the last slice is kept.
function pause() {
  paused = true;
  if (current) {
    stopWhy = "pause";
    bg({ type: "tr-state", id: current, phase: "paused", text: "Paused while recording" });
  }
  killWorker("paused");
}

function resume() {
  paused = false;
  pump();
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== "offscreen") return;
  if (msg.type === "tr-kick") pump();
  else if (msg.type === "tr-abort" && msg.id === current) {
    stopWhy = "cancel";
    killWorker("cancelled");
  }
});

return { pause, resume };
})();
