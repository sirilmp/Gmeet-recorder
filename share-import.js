// Import a recording someone shared from their Drive: the folder Meet Recorder made there
// (video + <name>.meetrec.json + transcript), downloaded as a .zip or as the files themselves.
// Loaded after library.js and uses its helpers (toast, render, getRecords, stampOf, trKey, ...).

// ---------- reading a .zip (Drive's folder download) without loading it into memory ----------
async function zipEntries(file) {
  const tailLen = Math.min(file.size, 65535 + 22 + 20);
  const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`"${file.name}" is not a zip file, or it is incomplete`);
  let count = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOff = tail.getUint32(eocd + 16, true);
  // Zip64 (big files): the real numbers are in a second record just before
  if (count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) {
    const loc = eocd - 20;
    if (loc >= 0 && tail.getUint32(loc, true) === 0x07064b50) {
      const at = Number(tail.getBigUint64(loc + 8, true));
      const z = new DataView(await file.slice(at, at + 56).arrayBuffer());
      if (z.getUint32(0, true) !== 0x06064b50) throw new Error(`"${file.name}" could not be read`);
      count = Number(z.getBigUint64(32, true));
      cdSize = Number(z.getBigUint64(40, true));
      cdOff = Number(z.getBigUint64(48, true));
    }
  }
  const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const names = new TextDecoder();
  const out = [];
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cd.byteLength; i++) {
    if (cd.getUint32(p, true) !== 0x02014b50) break;
    const flags = cd.getUint16(p + 8, true);
    const method = cd.getUint16(p + 10, true);
    let comp = cd.getUint32(p + 20, true);
    let size = cd.getUint32(p + 24, true);
    const nl = cd.getUint16(p + 28, true);
    const xl = cd.getUint16(p + 30, true);
    const cl = cd.getUint16(p + 32, true);
    let local = cd.getUint32(p + 42, true);
    const name = names.decode(new Uint8Array(cd.buffer, p + 46, nl));
    for (let x = p + 46 + nl; x + 4 <= p + 46 + nl + xl; ) {
      const id = cd.getUint16(x, true);
      const len = cd.getUint16(x + 2, true);
      if (id === 1) {
        let q = x + 4;
        const big = () => Number(cd.getBigUint64((q += 8) - 8, true));
        if (size === 0xffffffff) size = big();
        if (comp === 0xffffffff) comp = big();
        if (local === 0xffffffff) local = big();
      }
      x += 4 + len;
    }
    p += 46 + nl + xl + cl;
    if (name.endsWith("/")) continue;
    out.push({ path: name, size, open: () => zipStream(file, { method, comp, local, encrypted: flags & 1, name }) });
  }
  return out;
}

async function zipStream(file, e) {
  if (e.encrypted) throw new Error(`"${e.name}" in the zip is password protected`);
  const h = new DataView(await file.slice(e.local, e.local + 30).arrayBuffer());
  if (h.getUint32(0, true) !== 0x04034b50) throw new Error(`"${e.name}" in the zip could not be read`);
  const start = e.local + 30 + h.getUint16(26, true) + h.getUint16(28, true);
  const raw = file.slice(start, start + e.comp).stream();
  if (e.method === 0) return raw;
  if (e.method === 8) return raw.pipeThrough(new DecompressionStream("deflate-raw"));
  throw new Error(`"${e.name}" uses a zip compression this browser can't open`);
}

// ---------- matching the info files with their videos ----------
const baseName = (path) => path.split(/[\\/]/).pop();
const dirName = (path) => path.split(/[\\/]/).slice(0, -1).join("/");
const isVideo = (path) => /\.(mp4|webm)$/i.test(path);

// The info file comes from someone else's Drive: keep only what we expect, in the shapes we expect
function cleanMeta(raw) {
  if (!raw || raw.format !== PKG_FORMAT) return null;
  const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const str = (v, max) => (typeof v === "string" ? v : "").slice(0, max);
  const startedAt = num(raw.startedAt, Date.parse(raw.recordedAt) || 0);
  if (!startedAt) return null;
  const tr = raw.transcript && Array.isArray(raw.transcript.segments) ? raw.transcript : null;
  const trStatus = tr && tr.segments.length ? "done" : raw.transcriptStatus === "in-progress" ? "in-progress" : "none";
  return {
    trStatus,
    trPct: trStatus === "in-progress" ? Math.min(100, Math.max(0, Math.round(num(raw.transcriptProgress)))) : null,
    name: str(raw.name, 200).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").trim() || "Meeting",
    startedAt,
    durationMs: Math.max(0, num(raw.durationMs)),
    mode: raw.mode === "screen" ? "screen" : "tab",
    video: baseName(str(raw.video, 400)),
    ext: raw.ext === "mp4" ? "mp4" : raw.ext === "webm" ? "webm" : null,
    by: str(raw.recordedBy, 200) || null,
    bookmarks: (Array.isArray(raw.bookmarks) ? raw.bookmarks : [])
      .map((b) => (typeof b === "number" ? { ms: b, note: "" } : { ms: num(b && b.ms, -1), note: str(b && b.note, 500).trim() }))
      .filter((b) => b.ms >= 0)
      .map(({ ms, note }) => (note ? { ms: Math.round(ms), note } : { ms: Math.round(ms) })),
    transcript: tr
      ? {
          model: str(tr.model, 200) || null,
          lang: str(tr.lang, 40) || null,
          at: num(tr.at) || Date.now(),
          segments: tr.segments
            .filter((x) => x && typeof x.t === "string")
            .map((x) => ({
              s: Math.max(0, num(x.s)),
              e: Math.max(0, num(x.e, num(x.s))),
              t: x.t.slice(0, 2000),
              ...(typeof x.sp === "string" && x.sp.trim() ? { sp: x.sp.trim().slice(0, 60) } : {}),
            })),
        }
      : null,
  };
}

async function findPackages(files) {
  const items = [];
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) items.push(...(await zipEntries(f)));
    else items.push({ path: f.webkitRelativePath || f.name, size: f.size, open: async () => f.stream() });
  }
  const found = [];
  const problems = [];
  for (const info of items.filter((i) => i.path.toLowerCase().endsWith(PKG_SUFFIX))) {
    let meta = null;
    try {
      meta = cleanMeta(JSON.parse(await new Response(await info.open()).text()));
    } catch {}
    if (!meta) {
      problems.push(`${baseName(info.path)} is not a Meet Recorder file`);
      continue;
    }
    const dir = dirName(info.path);
    const videos = items.filter((i) => isVideo(i.path));
    const video =
      videos.find((i) => dirName(i.path) === dir && baseName(i.path) === meta.video) ||
      videos.find((i) => baseName(i.path) === meta.video) ||
      (() => {
        const here = videos.filter((i) => dirName(i.path) === dir);
        return here.length === 1 ? here[0] : null;
      })();
    if (!video) problems.push(`the video of "${meta.name}" (${meta.video || "no name"}) is missing`);
    else found.push({ meta, video });
  }
  if (!found.length && !problems.length)
    problems.push(
      items.some((i) => isVideo(i.path))
        ? "there's no Meet Recorder info file (.meetrec.json) next to the video"
        : "no recording was found in what you picked"
    );
  return { found, problems };
}

// ---------- a recording that is already in the library ----------
// Adds the shared transcript when this copy has none, and bookmarks it doesn't have (or their notes).
// Returns true when something was added.
async function mergeInto(rec, meta) {
  let changed = false;
  const key = trKey(rec);
  if (meta.transcript && meta.transcript.segments.length && !(await chrome.storage.local.get(key))[key]) {
    await chrome.storage.local.set({ [key]: meta.transcript });
    changed = true;
  }
  const marks = marksOf(rec);
  for (const b of meta.bookmarks) {
    const same = marks.find((m) => Math.abs(m.ms - b.ms) < 1000);
    if (!same) marks.push({ ms: b.ms, note: b.note || "" });
    else if (!same.note && b.note) same.note = b.note;
    else continue;
    changed = true;
  }
  const patch = {};
  if (changed) {
    marks.sort((a, b) => a.ms - b.ms);
    patch.bookmarks = marks.map(({ ms, note }) => (note ? { ms, note } : { ms }));
  }
  if (rec.imported && rec.imported.trStatus === "in-progress" && meta.trStatus !== "in-progress") {
    patch.imported = { ...rec.imported, trStatus: meta.trStatus, trPct: null };
  } else if (rec.imported && meta.trStatus === "in-progress" && meta.trPct !== rec.imported.trPct) {
    patch.imported = { ...rec.imported, trPct: meta.trPct };
  }
  if (Object.keys(patch).length) await updateRecord(rec.downloadId, patch);
  return changed;
}

// ---------- adding one to the library ----------
// Same path a recovered recording takes: a private copy for playing, then a download into
// Downloads/MeetRecordings that the background adds to the list (from "saving").
async function importOne({ meta, video, source }, onProgress) {
  const ext = meta.ext || (/\.mp4$/i.test(video.path) ? "mp4" : "webm");
  const root = await navigator.storage.getDirectory();
  const keepName = `keep-${meta.startedAt}.${ext}`;
  const h = await root.getFileHandle(keepName, { create: true });
  try {
    let done = 0;
    let shown = -1;
    const count = new TransformStream({
      transform(chunk, ctl) {
        done += chunk.byteLength;
        const pct = video.size ? Math.min(99, Math.round((done / video.size) * 100)) : 0;
        if (pct !== shown) onProgress((shown = pct));
        ctl.enqueue(chunk);
      },
    });
    await (await video.open()).pipeThrough(count).pipeTo(await h.createWritable());
  } catch (e) {
    await root.removeEntry(keepName).catch(() => {});
    throw e;
  }
  const kept = await h.getFile();
  let durationMs = meta.durationMs;
  if (!durationMs) {
    durationMs = await new Promise((res) => {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => res(isFinite(v.duration) ? v.duration * 1000 : 0);
      v.onerror = () => res(0);
      v.src = URL.createObjectURL(kept);
    });
  }
  if (meta.transcript && meta.transcript.segments.length) await chrome.storage.local.set({ [trKey(meta)]: meta.transcript });
  await chrome.storage.local.set({
    saving: {
      name: meta.name,
      mode: meta.mode,
      startedAt: meta.startedAt,
      durationMs,
      size: kept.size,
      filename: `${meta.name} ${stampOf(meta.startedAt)}.${ext}`,
      ext,
      bookmarks: meta.bookmarks,
      imported: {
        at: Date.now(),
        by: meta.by,
        ...(meta.trStatus === "in-progress" ? { trStatus: "in-progress", trPct: meta.trPct } : {}),
        ...(source ? { source } : {}), // the Drive folder it came from, to fetch a transcript finished later
      },
    },
  });
  const url = URL.createObjectURL(new Blob([kept], { type: `video/${ext}` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `imported.${ext}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
  // Wait until the background has added it to the list, so the next import can use "saving"
  for (let i = 0; i < 100; i++) {
    if (!(await chrome.storage.local.get("saving")).saving) return;
    await new Promise((r) => setTimeout(r, 100));
  }
}

let importing = false;
async function importFiles(files) {
  if (!files.length) return;
  await importFound(async () => findPackages([...files]));
}

// found: [{ meta, video: { path, size, open() } }]; problems: what couldn't be used, in words
async function importFound(read) {
  if (importing) return toast("An import is already running");
  importing = true;
  try {
    toast("Reading…");
    const { found, problems } = await read();
    const have = new Map((await getRecords()).map((r) => [r.startedAt, r]));
    const added = [];
    const merged = [];
    const skipped = [];
    for (const pkg of found) {
      const mine = have.get(pkg.meta.startedAt);
      if (mine) {
        // Already in the library (e.g. imported before the transcript was done): add what's new
        (await mergeInto(mine, pkg.meta)) ? merged.push(pkg.meta.name) : skipped.push(pkg.meta.name);
        continue;
      }
      await importOne(pkg, (pct) => toast(`Importing "${pkg.meta.name}"… ${pct}%`));
      have.set(pkg.meta.startedAt, true);
      added.push(pkg.meta.name);
    }
    const parts = [];
    if (added.length) parts.push(added.length === 1 ? `Imported "${added[0]}"` : `Imported ${added.length} recordings`);
    if (merged.length) parts.push(`Added the transcript and notes to ${merged.length === 1 ? `"${merged[0]}"` : `${merged.length} recordings`} you already had`);
    if (skipped.length) parts.push(`${skipped.length === 1 ? `"${skipped[0]}" is` : `${skipped.length} recordings are`} already in your library`);
    if (problems.length) parts.push(`Not imported: ${problems.join("; ")}`);
    toast(parts.join(". ") + ".", !added.length && !merged.length && !skipped.length);
    render();
  } catch (e) {
    toast(`Could not import: ${e.message}`, true);
  }
  importing = false;
}

// ---------- straight from a Drive link (through this user's own connected Drive script) ----------
async function readDriveLink(conn, link) {
  const { packages = [], token, name } = await driveReadShared(conn, link);
  const found = [];
  const problems = [];
  for (const p of packages) {
    let meta = null;
    try {
      meta = cleanMeta(JSON.parse(p.meta));
    } catch {}
    if (!meta) {
      problems.push("a recording info file could not be read");
      continue;
    }
    const v = p.videos.find((x) => x.name === meta.video) || (p.videos.length === 1 ? p.videos[0] : null);
    if (!v) problems.push(`the video of "${meta.name}" is not in the folder`);
    else
      found.push({
        meta,
        source: driveLinkId(link),
        video: { path: v.name, size: v.size, open: async () => driveFileStream(conn, v.id, v.size, token) },
      });
  }
  if (!packages.length) problems.push(`"${name || "that folder"}" has no Meet Recorder recording in it`);
  return { found, problems };
}

async function importLink() {
  const msg = (t, cls = "") => (($("imp-msg").textContent = t), ($("imp-msg").className = "dlg-msg " + cls));
  const link = $("imp-link").value.trim();
  if (!driveLinkId(link)) return msg("Paste the link of the shared folder: it starts with https://drive.google.com/", "err");
  const conn = await getConn();
  if (!conn) {
    msg("Connect your own Google Drive first (one time). It's how Meet Recorder opens folders shared with you.", "err");
    $("dlg-import").close();
    toast("Connect your Google Drive first, then paste the link again");
    return openConnect();
  }
  $("imp-go").disabled = true;
  msg("Opening the folder…");
  try {
    const oldUrl = conn.url;
    const got = await readDriveLink(conn, link);
    if (conn.url !== oldUrl) await chrome.storage.local.set({ driveConn: conn });
    $("dlg-import").close();
    $("imp-link").value = "";
    msg("");
    await importFound(async () => got);
  } catch (e) {
    msg(/UrlFetchApp|external_request/i.test(e.message) ? "Your Drive script needs one more permission: in the script editor pick “authorize”, click Run and Allow." : e.message, "err");
  }
  $("imp-go").disabled = false;
}

// ---------- a transcript the sender finished after you imported ----------
async function fetchSharedTranscript(rec) {
  const conn = await getConn();
  if (!conn) {
    toast("Connect your Google Drive first, then try again");
    return openConnect();
  }
  $("tr-fetch").disabled = true;
  $("tr-state").textContent = "Checking Drive…";
  try {
    const { packages = [] } = await driveReadShared(conn, rec.imported.source);
    let meta = null;
    for (const p of packages) {
      try {
        const m = cleanMeta(JSON.parse(p.meta));
        if (m && m.startedAt === rec.startedAt) meta = m;
      } catch {}
    }
    if (!meta) throw new Error("this recording is no longer in that Drive folder");
    if (meta.transcript && meta.transcript.segments.length) {
      await chrome.storage.local.set({ [trKey(rec)]: meta.transcript });
      rec.imported = { ...rec.imported, trStatus: "done", trPct: 100 };
      await updateRecord(rec.downloadId, { imported: rec.imported });
      toast("Got the finished transcript");
      if (playerRec === rec) loadTranscript(rec);
      render();
    } else {
      const pct = meta.trStatus === "in-progress" ? meta.trPct : null;
      rec.imported = { ...rec.imported, trStatus: pct != null ? "in-progress" : "none", trPct: pct };
      await updateRecord(rec.downloadId, { imported: rec.imported });
      if (playerRec === rec) loadTranscript(rec);
      $("tr-state").textContent = pct != null ? `Still being made (${pct}%). Try again later.` : "The sender has no transcript for it.";
      render();
    }
  } catch (e) {
    $("tr-state").textContent = "";
    toast(`Could not check Drive: ${e.message}`, true);
  }
  $("tr-fetch").disabled = false;
}
$("tr-fetch").onclick = () => playerRec && fetchSharedTranscript(playerRec);

// ---------- the Import button, dialog and drag & drop ----------
$("import-btn").onclick = () => {
  $("imp-msg").textContent = "";
  $("dlg-import").showModal();
  $("imp-link").focus();
};
$("imp-cancel").onclick = () => $("dlg-import").close();
$("dlg-import").querySelector("form").addEventListener("submit", (e) => {
  e.preventDefault(); // Enter in the link box or the Import button
  importLink();
});
$("imp-files").onclick = () => $("imp-file-input").click();
$("imp-folder").onclick = () => $("imp-folder-input").click();
for (const id of ["imp-file-input", "imp-folder-input"]) {
  $(id).onchange = () => {
    const files = [...$(id).files];
    $(id).value = "";
    $("dlg-import").close();
    importFiles(files);
  };
}
let dragDepth = 0;
const dragHasFiles = (e) => [...(e.dataTransfer ? e.dataTransfer.types : [])].includes("Files");
document.addEventListener("dragenter", (e) => {
  if (!dragHasFiles(e)) return;
  dragDepth++;
  document.body.classList.add("dropping");
});
document.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) (dragDepth = 0), document.body.classList.remove("dropping");
});
document.addEventListener("dragover", (e) => dragHasFiles(e) && e.preventDefault());
// A dropped folder arrives as an entry to walk; its files get the folder path, like the folder picker gives
async function droppedFiles(dt) {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!entries.some((en) => en.isDirectory)) return [...dt.files];
  const out = [];
  const walk = async (en, path) => {
    if (en.isFile) {
      const f = await new Promise((res, rej) => en.file(res, rej));
      out.push(new File([f], f.name, { type: f.type, lastModified: f.lastModified }));
      Object.defineProperty(out[out.length - 1], "webkitRelativePath", { value: path + f.name });
    } else if (en.isDirectory) {
      const reader = en.createReader();
      for (;;) {
        const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const child of batch) await walk(child, path + en.name + "/");
      }
    }
  };
  for (const en of entries) await walk(en, "");
  return out;
}
document.addEventListener("drop", async (e) => {
  if (!dragHasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("dropping");
  if ($("dlg-import").open) $("dlg-import").close();
  try {
    importFiles(await droppedFiles(e.dataTransfer));
  } catch (err) {
    toast(`Could not read what you dropped: ${err.message}`, true);
  }
});
