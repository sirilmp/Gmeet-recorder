// Speech-to-text that runs entirely on this PC (Whisper via transformers.js + ONNX Runtime WebAssembly).
// The audio never leaves the machine. The model files are fetched once from Hugging Face and then cached.
import { pipeline, env } from "./vendor/transformers.bundle.js";

env.allowLocalModels = false;
env.useBrowserCache = true;
env.useWasmCache = false;
env.backends.onnx.wasm.numThreads = 1; // no cross-origin isolation in an extension page
env.backends.onnx.wasm.wasmPaths = {
  mjs: new URL("./vendor/ort-wasm-simd-threaded.asyncify.mjs", import.meta.url).href,
  wasm: new URL("./vendor/ort-wasm-simd-threaded.asyncify.wasm", import.meta.url).href,
};

const RATE = 16000;
let loaded = { model: null, pipe: null };

async function load(model) {
  if (loaded.model === model) return loaded.pipe;
  const files = {};
  const pipe = await pipeline("automatic-speech-recognition", model, {
    dtype: "q8",
    device: "wasm",
    progress_callback: (p) => {
      if (p.status === "progress" && p.file) {
        files[p.file] = { loaded: p.loaded || 0, total: p.total || 0 };
        let l = 0;
        let t = 0;
        for (const f of Object.values(files)) {
          l += f.loaded;
          t += f.total;
        }
        postMessage({ type: "download", loaded: l, total: t });
      }
    },
  });
  loaded = { model, pipe };
  return pipe;
}

// One 30 s slice at a time: {type: "slice", id, audio (16 kHz mono), offset (seconds), model, language}
// -> {type: "segments", id, segments: [{s, e, t}]} with times on the recording's timeline.
onmessage = async (e) => {
  const m = e.data;
  if (m.type !== "slice") return;
  try {
    const pipe = await load(m.model);
    const part = m.audio;
    const segments = [];
    // skip silence quickly
    let peak = 0;
    for (let k = 0; k < part.length; k += 16) peak = Math.max(peak, Math.abs(part[k]));
    if (peak > 0.003 && part.length > RATE * 0.5) {
      const opts = { return_timestamps: true };
      if (!/\.en$/.test(m.model)) {
        opts.task = "transcribe";
        if (m.language && m.language !== "auto") opts.language = m.language;
      }
      const out = await pipe(part, opts);
      for (const c of out.chunks || []) {
        const text = (c.text || "").trim();
        if (!text) continue;
        const s = m.offset + (c.timestamp[0] ?? 0);
        const en = m.offset + (c.timestamp[1] ?? c.timestamp[0] + 2);
        segments.push({ s: Math.round(s * 10) / 10, e: Math.round(en * 10) / 10, t: text });
      }
    }
    postMessage({ type: "segments", id: m.id, segments });
  } catch (err) {
    postMessage({ type: "error", id: m.id, message: String((err && err.message) || err) });
  }
};
