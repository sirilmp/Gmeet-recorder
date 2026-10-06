const $ = (id) => document.getElementById(id);

const ICON = {
  text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 10.5h16M4 15h10M4 19.5h7"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
  video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="15" height="14" rx="2"/><path d="M18 10l4-2v8l-4-2"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  disk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18a4 4 0 0 1-.5-7.97A6 6 0 0 1 18 9.5 4.25 4.25 0 0 1 17.5 18H7z"/><path d="M12 12v6M9.5 14.5L12 12l2.5 2.5"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M6.5 9.5L12 4l5.5 5.5M4 20h16"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
};

// Bookmarks used to be saved as plain ms numbers; ones with notes are { ms, note }.
function marksOf(rec) {
  return (rec.bookmarks || []).map((b) => (typeof b === "number" ? { ms: b, note: "" } : { ms: b.ms, note: b.note || "" }));
}

function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${Math.floor(s / 3600)}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

// 09-02-2026 · 9:01 AM
function fmtDateTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} · ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function fmtSize(b) {
  return b > 1e9 ? (b / 1e9).toFixed(2) + " GB" : (b / 1e6).toFixed(1) + " MB";
}

let toastTimer;
function toast(text, isErr = false) {
  const t = $("toast");
  t.textContent = text;
  t.className = "show" + (isErr ? " err" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ""), isErr ? 12000 : 4500);
}

async function getRecords() {
  const { recordings = [] } = await chrome.storage.local.get("recordings");
  return recordings;
}

async function updateRecord(downloadId, patch) {
  const recordings = await getRecords();
  const r = recordings.find((x) => x.downloadId === downloadId);
  if (r) Object.assign(r, patch);
  await chrome.storage.local.set({ recordings });
}

async function removeRecord(downloadId) {
  const recordings = (await getRecords()).filter((x) => x.downloadId !== downloadId);
  await chrome.storage.local.set({ recordings });
}

const search = (query) => new Promise((res) => chrome.downloads.search(query, res));

// ---------- Google Drive ----------
function dayName(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Each user connects their own Drive through a small Apps Script in their account (see drive.js).
async function getConn() {
  const { driveConn } = await chrome.storage.local.get("driveConn");
  return driveConn && driveConn.url ? driveConn : null;
}

async function driveKey() {
  let { driveKey } = await chrome.storage.local.get("driveKey");
  if (!driveKey) {
    driveKey = [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(16).padStart(2, "0")).join("");
    await chrome.storage.local.set({ driveKey });
  }
  return driveKey;
}

async function renderDriveBtn() {
  const conn = await getConn();
  const b = $("drive-btn");
  b.className = "btn" + (conn ? " on" : "");
  b.innerHTML = ICON.cloud + `<span>${conn ? "Drive connected" : "Connect Google Drive"}</span>`;
  b.title = conn && conn.email ? `Uploads go to ${conn.email}` : "";
}

function connectMsg(text, cls = "") {
  $("connect-msg").textContent = text;
  $("connect-msg").className = "dlg-msg " + cls;
}

async function openConnect() {
  const conn = await getConn();
  $("script-code").value = DRIVE_SCRIPT.replace("__KEY__", await driveKey());
  $("script-url").value = conn ? conn.url : "";
  $("disconnect").hidden = !conn;
  connectMsg(conn ? `Connected: uploads go to ${conn.email || "your Drive"}` : "", conn ? "ok" : "");
  // Accordion: first step open (all closed when already connected)
  document.querySelectorAll("#steps .step").forEach((d, i) => (d.open = !conn && i === 0));
  $("dlg-connect").showModal();
}

// Opening a step closes the others; "Done, next" moves on to the next one
document.querySelectorAll("#steps .step").forEach((d) => {
  d.addEventListener("toggle", () => {
    if (d.open) document.querySelectorAll("#steps .step").forEach((o) => o !== d && (o.open = false));
  });
});
document.querySelectorAll("#steps .next").forEach((b) => {
  b.onclick = () => {
    const d = b.closest(".step");
    d.open = false;
    const n = d.nextElementSibling;
    if (n) n.open = true;
  };
});

$("drive-btn").onclick = openConnect;
$("copy-code").onclick = async () => {
  await navigator.clipboard.writeText($("script-code").value);
  $("copy-code").textContent = "Copied ✓";
  setTimeout(() => ($("copy-code").textContent = "Copy"), 2000);
};
$("copy-name").onclick = async () => {
  await navigator.clipboard.writeText("Meet Recorder Drive Upload");
  $("copy-name").textContent = "Copied ✓";
  setTimeout(() => ($("copy-name").textContent = "Copy name"), 2000);
};
$("save-conn").onclick = async () => {
  const url = $("script-url").value.trim();
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) {
    connectMsg("Paste the Web app URL: it starts with https://script.google.com/ and ends with /exec", "err");
    return;
  }
  $("save-conn").disabled = true;
  connectMsg("Testing the connection…");
  try {
    const conn = { url, key: await driveKey() };
    const { email, v } = await driveScriptCall(conn, { action: "ping" });
    await chrome.storage.local.set({ driveConn: { ...conn, email } });
    $("script-url").value = conn.url; // may be the company (/a/macros/…) link
    scriptV = v || 1;
    if (v >= DRIVE_SCRIPT_V) connectMsg(`Connected ✓ Uploads go to ${email || "your Drive"}`, "ok");
    else connectMsg(`Connected to ${email || "your Drive"}, but with an older script, so meetings don't get their own folders. Paste the code from step 1 over it, then Deploy → Manage deployments → ✏️ → New version → Deploy.`, "err");
    renderDriveNote();
    $("disconnect").hidden = false;
    renderDriveBtn();
  } catch (e) {
    connectMsg(
      /permission|authoriz/i.test(e.message)
        ? "Google has not allowed all permissions yet. In the script editor pick “authorize”, click Run and Allow, then press Connect & test again."
        : "Could not connect: " + e.message,
      "err"
    );
  }
  $("save-conn").disabled = false;
};
$("disconnect").onclick = async () => {
  await chrome.storage.local.remove("driveConn");
  $("script-url").value = "";
  $("disconnect").hidden = true;
  connectMsg("Disconnected. You can also delete the script at script.google.com.");
  renderDriveBtn();
};

// Read the recording: from the copy the recorder kept (new recordings), else from the
// MeetRecordings folder the user chose once (older recordings).
function askFileAccess() {
  return new Promise((resolve) => {
    const d = $("dlg-files");
    d.returnValue = "";
    d.onclose = () => resolve(d.returnValue);
    d.showModal();
  });
}

// Copies the recorder keeps inside the extension (keep-<startedAt>.webm or .mp4), so uploads need no file access
const KEEP_DAYS = 14;
const extOf = (rec) => (rec.ext === "mp4" ? "mp4" : "webm");
const mimeOf = (rec) => `video/${extOf(rec)}`;
async function keptFile(rec) {
  try {
    const root = await navigator.storage.getDirectory();
    const h = await root.getFileHandle(`keep-${rec.startedAt}.${extOf(rec)}`);
    const f = await h.getFile();
    return f.size ? new Blob([f], { type: mimeOf(rec) }) : null;
  } catch {
    return null;
  }
}

async function dropKept(rec) {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(`keep-${rec.startedAt}.${extOf(rec)}`);
  } catch {}
}

// Free the space of copies that are uploaded, deleted from the list, or older than KEEP_DAYS
async function pruneKept() {
  try {
    const recs = await getRecords();
    // recordings waiting for a transcript are read from these copies too
    const { trQueue = [] } = await chrome.storage.local.get("trQueue");
    const queued = new Set(trQueue.map((x) => x.id));
    // Imported recordings count their days from the import, not from when they were recorded
    const wanted = new Map(
      recs.filter((r) => !r.uploaded || queued.has(r.startedAt)).map((r) => [`keep-${r.startedAt}.${extOf(r)}`, r.imported ? r.imported.at : r.startedAt])
    );
    const root = await navigator.storage.getDirectory();
    for await (const [name, h] of root.entries()) {
      // trsrc-*: a copy made just for a transcript, gone once it is no longer queued
      if (name.startsWith("trsrc-") && !queued.has(parseInt(name.slice(6), 10))) await root.removeEntry(name).catch(() => {});
      if (!name.startsWith("keep-")) continue;
      const age = Date.now() - (wanted.get(name) || parseInt(name.slice(5), 10));
      if (!wanted.has(name) || !(age < KEEP_DAYS * 864e5 || queued.has(parseInt(name.slice(5), 10)))) await root.removeEntry(name).catch(() => {});
    }
  } catch {}
}

async function readLocalFile(rec, item) {
  const kept = await keptFile(rec);
  if (kept) return kept;
  const fileName = item.filename.split(/[\\/]/).pop();

  // The MeetRecordings folder the user chose once (remembered), read the file by name from it
  let dir = await savedFolder();
  if (dir && (await dir.queryPermission({ mode: "read" })) !== "granted") {
    if ((await dir.requestPermission({ mode: "read" })) !== "granted") dir = null;
  }
  if (!dir) {
    if ((await askFileAccess()) !== "folder") throw new DOMException("Cancelled", "AbortError");
    dir = await window.showDirectoryPicker({ id: "meetrec", startIn: "downloads", mode: "read" });
    await saveFolder(dir);
  }
  try {
    const f = await (await dir.getFileHandle(fileName)).getFile();
    return new Blob([f], { type: mimeOf(rec) });
  } catch {
    await saveFolder(null); // wrong folder: ask again next time
    throw new Error(`"${fileName}" is not in the folder "${dir.name}". Press Upload again and choose the MeetRecordings folder.`);
  }
}

// Folder handle stored in IndexedDB (handles can't go in chrome.storage)
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("meetrec", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function savedFolder() {
  try {
    const db = await idb();
    return await new Promise((resolve) => {
      const q = db.transaction("kv").objectStore("kv").get("folder");
      q.onsuccess = () => resolve(q.result || null);
      q.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}
async function saveFolder(handle) {
  try {
    const db = await idb();
    const tx = db.transaction("kv", "readwrite");
    if (handle) tx.objectStore("kv").put(handle, "folder");
    else tx.objectStore("kv").delete("folder");
  } catch {}
}

function askFolder(rec, fileName) {
  return new Promise((resolve) => {
    const d = $("dlg-upload");
    $("up-file").textContent = fileName;
    $("up-sub").textContent = pkgFolderName(fileName);
    $("up-old").hidden = !(scriptV != null && scriptV < 2);
    $("up-folder").value = dayName(rec.startedAt);
    $("up-where").textContent = $("up-folder").value;
    $("up-folder").oninput = () => ($("up-where").textContent = $("up-folder").value.trim());
    d.returnValue = "";
    d.onclose = () => resolve(d.returnValue === "ok" ? $("up-folder").value.trim() : null);
    d.showModal();
    $("up-folder").select();
  });
}

const uploading = new Map(); // downloadId -> percent, survives re-renders

function showProgress(id) {
  const pct = uploading.get(id);
  document.querySelectorAll(`[data-up="${id}"]`).forEach((p) => {
    p.hidden = pct === undefined;
    p.value = pct || 0;
  });
  document.querySelectorAll(`[data-up-btn="${id}"]`).forEach((b) => {
    b.disabled = pct !== undefined;
    b.querySelector("span").textContent = pct === undefined ? "" : `${pct}%`;
    b.title = pct === undefined ? "Upload to Google Drive" : `Uploading ${pct}%`;
  });
}

async function uploadToDrive(rec, item) {
  const conn = await getConn();
  if (!conn) {
    toast("Connect your Google Drive first (one time)");
    openConnect();
    return;
  }
  const fileName = item.filename.split(/[\\/]/).pop();
  const folder = await askFolder(rec, fileName);
  if (!folder) return;
  const id = rec.downloadId;
  const oldUrl = conn.url;
  try {
    const blob = await readLocalFile(rec, item);
    let sentPct = null; // transcript progress the uploaded info file carries
    uploading.set(id, 0);
    showProgress(id);
    const out = await driveUploadPackage(
      conn,
      blob,
      rec,
      fileName,
      folder,
      () => storedTranscript(rec),
      (p) => {
        uploading.set(id, p);
        showProgress(id);
      },
      async () => (sentPct = await trPctFor(rec.startedAt))
    );
    uploading.delete(id);
    if (conn.url !== oldUrl) await chrome.storage.local.set({ driveConn: conn });
    await updateRecord(id, {
      uploaded: true,
      driveUrl: out.fileUrl,
      folderUrl: out.folderUrl,
      driveFolderId: out.folderId,
      packaged: out.packaged,
      driveName: fileName,
    });
    // A transcript still being made reads the kept copy: leave it until that's done (pruneKept frees it)
    if (sentPct == null) dropKept(rec);
    if (sentPct != null && !out.sidecarError) {
      // it may have moved on (or finished) while the upload was ending: the background sends the latest
      if (out.packaged) bgSend({ type: "drive-sync", id: rec.startedAt });
      toast(`"${rec.name}" is on Drive. Its transcript is still being made (${sentPct}%) and is added there when it's finished.`);
    } else if (out.sidecarError) toast(`"${rec.name}" is on Drive, but its transcript and notes were not: ${out.sidecarError}`, true);
    else if (!out.packaged) toast(`"${rec.name}" uploaded to Google Drive → ${folder}. Update your Drive script to keep each recording in its own folder.`);
    else toast(`"${rec.name}" uploaded to Google Drive → ${folder} → ${pkgFolderName(fileName)}`);
    render();
  } catch (e) {
    uploading.delete(id);
    showProgress(id);
    if (e.name === "AbortError") return;
    toast(
      /UrlFetchApp|external_request|permission/i.test(e.message)
        ? "Drive upload needs one more permission: in your script editor pick “authorize” (or “startUpload”), click Run and Allow, then try again."
        : `Upload failed for "${rec.name}": ${e.message}`,
      true
    );
  }
}

const storedTranscript = async (rec) => (await chrome.storage.local.get(trKey(rec)))[trKey(rec)] || null;

// The Drive folder that holds this recording (its own folder, or the date folder for older uploads)
const driveFolderOf = (rec) => rec.driveFolderId || ((rec.folderUrl || "").match(/\/folders\/([^/?#]+)/) || [])[1] || null;

// Send the transcript + notes to Drive again (edited bookmarks, a deleted transcript, the menu item).
// The background worker does it, one at a time with its own transcript-progress updates.
async function syncPackage(rec, quiet) {
  const out = (await bgSend({ type: "drive-sync", id: rec.startedAt })) || { error: "the extension did not answer" };
  if (out.ok) {
    if (!quiet) toast("Transcript and notes updated on Drive");
  } else if (!quiet) toast(out.skipped || `Could not update the transcript and notes on Drive: ${out.error}`, !!out.error || !!out.skipped);
  else if (out.error) toast(`Could not update the transcript and notes on Drive: ${out.error}`, true);
}

// ---------- one folder per meeting: script version + tidying older uploads ----------
const DRIVE_SCRIPT_V = 3; // what this extension's script code says (VERSION in drive.js)
let scriptV = null; // the connected script's version, from a ping (null: not known / not connected)

async function checkScript() {
  const conn = await getConn();
  scriptV = null;
  if (conn) {
    try {
      scriptV = (await driveScriptCall(conn, { action: "ping" })).v || 1;
    } catch {}
  }
  renderDriveNote();
}

// Uploaded before each meeting got a folder: the video sits loose in its date folder
const isLoose = (r) => r.uploaded && !r.packaged && /\/d\//.test(r.driveUrl || "");

async function videoNameOf(rec) {
  if (rec.driveName) return rec.driveName;
  const [item] = rec.downloadId ? await search({ id: rec.downloadId }) : [];
  return (item && item.filename.split(/[\\/]/).pop()) || `${rec.name} ${stampOf(rec.startedAt)}.${extOf(rec)}`;
}

async function renderDriveNote() {
  const box = $("drive-note");
  box.replaceChildren();
  if (scriptV == null) return;
  const row = (title, text, label, fn) => {
    const r = el("div", "recover info", `<div class="rt"><b>${esc(title)}</b><span>${esc(text)}</span></div>`);
    r.append(btn(ICON.cloud, label, "btn-primary", fn));
    box.append(r);
  };
  if (scriptV < DRIVE_SCRIPT_V) {
    row(
      "Update your Drive script",
      "Your Drive script is an older version, so recordings land loose in the date folder. With the new one, each meeting gets its own folder with its video, transcript and notes, ready to share and import.",
      "Update script",
      () => openConnect()
    );
    return;
  }
  const loose = (await getRecords()).filter(isLoose);
  if (loose.length)
    row(
      `${loose.length} older upload${loose.length > 1 ? "s are" : " is"} loose in a date folder`,
      "Move each into a folder named after the meeting, together with its transcript and notes.",
      "Put each in its own folder",
      () => organizeLoose(loose)
    );
}

let organizing = false;
async function organizeLoose(recs) {
  const conn = await getConn();
  if (!conn) return openConnect();
  if (organizing) return;
  organizing = true;
  let done = 0;
  const failed = [];
  for (const rec of recs) {
    toast(`Organizing Drive… ${done + 1} of ${recs.length}`);
    try {
      const videoName = await videoNameOf(rec);
      const out = await driveTidy(conn, rec, videoName);
      await updateRecord(rec.downloadId, { driveFolderId: out.folderId, folderUrl: out.folderUrl, packaged: true, driveName: videoName });
      // the info file + transcript (made now if they weren't there), so the folder can be shared and imported
      const synced = await bgSend({ type: "drive-sync", id: rec.startedAt });
      if (synced && synced.error) throw new Error(synced.error);
      done++;
    } catch (e) {
      failed.push(`"${rec.name}": ${e.message}`);
      if (e.message === DRIVE_OLD_SCRIPT) break;
    }
  }
  organizing = false;
  if (failed.length) toast(`${done ? `${done} moved. ` : ""}Not moved: ${failed.join("; ")}`, true);
  else toast(done === 1 ? `"${recs[0].name}" now has its own Drive folder` : `${done} recordings now have their own Drive folders`);
  render();
  renderDriveNote();
}

// ---------- UI ----------
function btn(html, label, cls, onclick) {
  const b = document.createElement("button");
  b.className = "btn " + (cls || "");
  b.innerHTML = html + `<span>${label}</span>`;
  b.onclick = onclick;
  return b;
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// Which day sections are open (Today/Yesterday open by default; the user's choice is remembered)
let openDays = {};
try {
  openDays = JSON.parse(localStorage.getItem("openDays") || "{}");
} catch {}
function saveOpenDays() {
  try {
    localStorage.setItem("openDays", JSON.stringify(openDays));
  } catch {}
}

function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

// ---------- Drive menu: open / folder / who can view ----------
const ACCESS_LABELS = () => {
  const dom = getConnCache && getConnCache.email && getConnCache.email.split("@")[1];
  const org = dom && dom !== "gmail.com" && dom !== "googlemail.com" ? dom : null;
  return [
    ["private", "Only me", "Restricted"],
    ...(org ? [["domain", `Anyone at ${org}`, "With the link"]] : []),
    ["anyone", "Anyone with the link", "No sign-in needed"],
  ];
};
let getConnCache = null;
function closeMenu() {
  const m = document.getElementById("drive-menu");
  if (m) m.remove();
}
document.addEventListener("click", (e) => {
  if (!e.target.closest("#drive-menu") && !e.target.closest("[data-menu-btn]")) closeMenu();
});
window.addEventListener("scroll", closeMenu, true);

async function openDriveMenu(anchor, rec) {
  closeMenu();
  getConnCache = await getConn();
  const m = el("div", "menu");
  m.id = "drive-menu";
  const item = (icon, label, sub, fn, on) => {
    const b = el("button", "mi" + (on ? " on" : ""), `${icon}<span>${label}${sub ? `<small>${sub}</small>` : ""}</span>${on ? "<i>✓</i>" : ""}`);
    b.type = "button";
    b.onclick = fn;
    return b;
  };
  const folderLink = rec.packaged && rec.folderUrl;
  if (folderLink) {
    m.append(item(ICON.folder, "Open Drive folder", "Video, transcript and notes", () => (window.open(rec.folderUrl, "_blank"), closeMenu())));
    m.append(
      item(ICON.copy, "Copy share link", "Others can import it into Meet Recorder", async () => {
        closeMenu();
        try {
          await navigator.clipboard.writeText(rec.folderUrl);
          toast("Folder link copied");
        } catch {
          toast("Could not copy the link", true);
        }
      })
    );
  }
  m.append(item(ICON.link, folderLink ? "Open video on Drive" : "Open on Drive", "", () => (window.open(rec.driveUrl, "_blank"), closeMenu())));
  m.append(
    item(ICON.copy, "Copy link", "", async () => {
      closeMenu();
      try {
        await navigator.clipboard.writeText(rec.driveUrl);
        toast("Drive link copied");
      } catch {
        toast("Could not copy the link", true);
      }
    })
  );
  if (rec.folderUrl && !folderLink) m.append(item(ICON.folder, "Open Drive folder", "", () => (window.open(rec.folderUrl, "_blank"), closeMenu())));
  if (!rec.packaged)
    m.append(
      item(ICON.folder, "Put in its own folder", "With its transcript and notes", async () => {
        closeMenu();
        await organizeLoose([rec]);
      })
    );
  if (driveFolderOf(rec))
    m.append(
      item(ICON.cloud, "Update transcript & notes", "Send the latest to Drive", async () => {
        closeMenu();
        toast("Updating Drive…");
        await syncPackage(rec, false);
      })
    );
  m.append(el("div", "mh", folderLink ? "Who can view the folder" : "Who can view"));
  let cur = rec.access || "private";
  const rows = [];
  const mark = () => rows.forEach(([k, b]) => {
    b.classList.toggle("on", k === cur);
    b.querySelector("i").textContent = k === cur ? "✓" : "";
  });
  let busy = false;
  for (const [key, label, sub] of ACCESS_LABELS()) {
    const b = item(ICON.lock, label, sub, async () => {
      if (busy || key === cur) return;
      const fileId = (rec.driveUrl.match(/\/d\/([^/?]+)/) || [])[1];
      busy = true;
      m.classList.add("busy");
      b.querySelector("i").innerHTML = '<span class="spin"></span>';
      try {
        if (!getConnCache) throw new Error("Connect your Google Drive first");
        const target = folderLink && rec.driveFolderId ? { folderId: rec.driveFolderId } : { fileId };
        if (!target.folderId && !target.fileId) throw new Error("The Drive link of this recording is missing");
        await driveShare(getConnCache, target, key);
        await updateRecord(rec.downloadId, { access: key });
        rec.access = cur = key;
        toast(`Access set: ${label}`);
      } catch (e) {
        toast(`Could not change access: ${e.message}`, true);
      }
      busy = false;
      m.classList.remove("busy");
      mark();
    }, key === cur);
    if (!b.querySelector("i")) b.append(document.createElement("i"));
    rows.push([key, b]);
    m.append(b);
  }
  mark();
  anchor.dataset.menuBtn = "1";
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  m.style.top = r.bottom + 6 + "px";
  m.style.left = Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8)) + "px";
}

async function buildCard(rec) {
  const [item] = await search({ id: rec.downloadId });
  const exists = item && item.exists && item.state === "complete";
  const saving = item && item.state === "in_progress";

  const card = el("div", "card");
  card.append(el("div", "thumb", ICON.video));

  const info = el("div", "info");
  const name = el("div", "name", `<span>${esc(rec.name)}</span>`);
  name.append(el("span", "chip tab", rec.mode === "screen" ? "Screen" : "Meet tab"));
  if (rec.imported) {
    const chip = el("span", "chip tab", "Shared");
    chip.title = rec.imported.by ? `Shared by ${rec.imported.by}` : "Imported from a shared Drive folder";
    name.append(chip);
  }
  if (rec.uploaded) name.append(el("span", "chip ok", "On Drive"));
  const trChip = el("span", "chip tab");
  trChip.dataset.tr = rec.startedAt;
  trChip.hidden = true;
  name.append(trChip);
  const trDone = el("span", "chip ok", "Transcript");
  trDone.dataset.trdone = rec.startedAt;
  trDone.title = "Transcript ready, open the recording to read it";
  trDone.hidden = true;
  name.append(trDone);
  if (rec.imported && rec.imported.trStatus === "in-progress") {
    const chip = el("span", "chip warn", "Transcript pending");
    chip.title = `The sender's transcript was ${rec.imported.trPct || 0}% done when you imported this. Open it to check Drive for the finished one.`;
    name.append(chip);
  }
  if (saving) name.append(el("span", "chip warn", "Saving…"));
  else if (!exists) name.append(el("span", "chip warn", rec.localDeleted ? "Removed from this PC" : "File missing"));
  info.append(name);
  info.append(
    el(
      "div",
      "meta",
      `<span>${ICON.cal}${new Date(rec.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>` +
        `<span>${ICON.clock}${fmtDuration(rec.durationMs)}</span>` +
        `<span>${ICON.disk}${fmtSize(rec.size)}</span>`
    )
  );
  if (rec.bookmarks && rec.bookmarks.length) {
    const marks = el("div", "marks");
    for (const { ms, note } of marksOf(rec)) {
      const m = el("button", "mark", `${ICON.bookmark}${fmtDuration(ms)}${note ? `<span class="mn">${esc(note)}</span>` : ""}`);
      m.title = note ? `${note}\nPlay from here` : "Play from here";
      m.onclick = () => playRecording(rec, item, ms / 1000);
      marks.append(m);
    }
    info.append(marks);
  }
  card.append(info);

  const actions = el("div", "actions");
  if (exists) {
    const ob = btn(ICON.play, "", "btn-primary", () => playRecording(rec, item, 0));
    ob.title = "Play recording";
    actions.append(ob);
    // Only while there is no transcript yet and none is being made (paintTrChips keeps this in sync)
    const tb = btn(ICON.text, "", "", () => transcribeFromCard(rec, item, tb));
    tb.title = "Make a transcript";
    tb.dataset.trbtn = rec.startedAt;
    tb.hidden = true;
    actions.append(tb);
    const bar = el("progress");
    bar.max = 100;
    bar.dataset.up = rec.downloadId;
    actions.append(bar);
    if (rec.uploaded && rec.driveUrl) {
      const db = btn(ICON.cloud, "▾", "", (e) => openDriveMenu(e.currentTarget, rec));
      db.title = "Google Drive: open, copy link, who can view";
      actions.append(db);
    } else {
      const up = btn(ICON.upload, "", "btn-upload", () => uploadToDrive(rec, item));
      up.title = "Upload to Google Drive";
      up.dataset.upBtn = rec.downloadId;
      actions.append(up);
    }
    const fb = btn(ICON.folder, "", "btn-ghost", () => chrome.downloads.show(rec.downloadId));
    fb.title = "Show file in folder";
    actions.append(fb);
  }
  actions.append(
    btn(ICON.trash, "", "btn-ghost btn-soft-danger", async () => {
      if (!confirm(`Delete "${rec.name}"${exists ? " and its file from disk" : ""}?`)) return;
      if (exists) await new Promise((r) => chrome.downloads.removeFile(rec.downloadId, r));
      await removeRecord(rec.downloadId);
      bgSend({ type: "tr-cancel", id: rec.startedAt });
      dropKept(rec);
      render();
    })
  );
  card.append(actions);
  return card;
}

// Several renders can overlap (download events fire in bursts): only the newest one may draw,
// and it swaps the whole list in one go, so cards are never added twice.
let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const all = (await getRecords()).sort((a, b) => b.startedAt - a.startedAt);
  const q = $("search").value.trim().toLowerCase();
  const records = q ? all.filter((r) => r.name.toLowerCase().includes(q)) : all;

  // Group by calendar day (newest first)
  const groups = new Map();
  for (const rec of records) {
    const key = dayName(rec.startedAt);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(rec);
  }

  const frag = document.createDocumentFragment();
  for (const [key, recs] of groups) {
    const label = dayLabel(recs[0].startedAt);
    const recent = label === "Today" || label === "Yesterday";
    const day = el("details", "day");
    day.open = q ? true : openDays[key] ?? recent; // searching opens everything
    const total = recs.reduce((n, r) => n + (r.durationMs || 0), 0);
    const summary = el(
      "summary",
      "",
      `<span class="chev">${ICON.chev}</span><span>${esc(label)}</span>` +
        `<span class="sum">${recs.length} recording${recs.length > 1 ? "s" : ""} · ${fmtDuration(total)}</span>` +
        `<span class="line"></span>`
    );
    day.append(summary);
    const body = el("div", "day-body");
    for (const rec of recs) body.append(await buildCard(rec));
    if (seq !== renderSeq) return; // a newer render started
    day.append(body);
    day.ontoggle = () => {
      if (q) return;
      openDays[key] = day.open;
      saveOpenDays();
    };
    frag.append(day);
  }
  if (seq !== renderSeq) return;

  $("stat-count").textContent = all.length;
  $("stat-size").textContent = fmtSize(all.reduce((n, r) => n + (r.size || 0), 0));
  $("empty").hidden = all.length > 0;
  $("list").replaceChildren(frag);
  paintTrChips();
  for (const id of uploading.keys()) showProgress(id);
  document.querySelectorAll("progress[data-up]").forEach((p) => (p.hidden = !uploading.has(+p.dataset.up)));
}

// ---------- Recover a recording that was cut short (browser/tab crashed, PC shut down) ----------
const stampOf = (ts) => {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`;
};

async function findUnfinished() {
  const { recording } = await chrome.storage.session.get("recording");
  if (recording) return [];
  const { pending } = await chrome.storage.local.get("pending");
  const root = await navigator.storage.getDirectory();
  const out = [];
  for await (const [name, h] of root.entries()) {
    // While a recording is being written its data sits in "<name>.crswap"; the real file stays at 0 bytes until the end
    const m = /^rec-(\d+)\.(webm|mp4)(\.crswap)?$/.exec(name);
    if (!m || h.kind !== "file") continue;
    const f = await h.getFile();
    // A fresh leftover is normal for a few minutes after a clean save; a pending entry means the crash was recent
    if (f.size > 100_000 && (pending || Date.now() - f.lastModified > 11 * 60_000))
      out.push({ name, ext: m[2], file: f, started: pending ? pending.startedAt : +m[1], meta: pending });
  }
  return out;
}

async function showRecover() {
  const box = $("recover");
  let found = [];
  try {
    found = await findUnfinished();
  } catch {}
  box.replaceChildren();
  for (const u of found) {
    const row = el(
      "div",
      "recover",
      `<div class="rt"><b>Unfinished recording found</b><span>${esc(u.meta ? u.meta.name : "Meeting")} · ${fmtDateTime(u.started)} · ${fmtSize(u.file.size)}. It was cut short, you can still save what was recorded.</span></div>`
    );
    const rec = btn(ICON.play, "Recover", "btn-primary", () => recoverFile(u, rec));
    const del = btn(ICON.trash, "Discard", "btn-ghost btn-soft-danger", async () => {
      if (!confirm("Delete this unfinished recording for good?")) return;
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(u.name).catch(() => {});
      await root.removeEntry(u.name.replace(/\.crswap$/, "")).catch(() => {});
      await chrome.storage.local.remove("pending");
      showRecover();
    });
    row.append(rec, del);
    box.append(row);
  }
}

async function recoverFile(u, button) {
  button.disabled = true;
  button.querySelector("span").textContent = "Recovering…";
  try {
    const ext = u.ext === "mp4" ? "mp4" : "webm";
    let blob = u.file;
    if (ext === "mp4") {
      blob = new Blob([u.file], { type: "video/mp4" }); // fragmented MP4: playable as it is
    } else {
      try {
        blob = await fixWebm(u.file); // adds duration + seek index
      } catch (e) {
        console.warn("webm fix skipped", e);
      }
    }
    // Real length from the fixed file (falls back to the time between start and last write)
    const durationMs = await new Promise((res) => {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => res(isFinite(v.duration) ? v.duration * 1000 : u.file.lastModified - u.started);
      v.onerror = () => res(Math.max(0, u.file.lastModified - u.started));
      v.src = URL.createObjectURL(blob);
    });
    const root = await navigator.storage.getDirectory();
    const keepName = `keep-${u.started}.${ext}`;
    const h = await root.getFileHandle(keepName, { create: true });
    const w = await h.createWritable();
    await blob.stream().pipeTo(w);
    const kept = await h.getFile();
    const name = ((u.meta && u.meta.name) || "Meeting") + " (recovered)";
    await chrome.storage.local.set({
      saving: {
        name,
        mode: (u.meta && u.meta.mode) || "tab",
        startedAt: u.started,
        durationMs,
        size: kept.size,
        filename: `${name} ${stampOf(u.started)}.${ext}`,
        ext,
      },
    });
    await chrome.storage.local.remove("pending");
    const url = URL.createObjectURL(kept);
    const a = document.createElement("a");
    a.href = url;
    a.download = `recovered.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    await root.removeEntry(u.name).catch(() => {});
    await root.removeEntry(u.name.replace(/\.crswap$/, "")).catch(() => {});
    setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
    toast("Recovered: saved in Downloads/MeetRecordings");
    showRecover();
  } catch (e) {
    toast(`Could not recover: ${e.message}`, true);
    button.disabled = false;
    button.querySelector("span").textContent = "Recover";
  }
}

// ---------- built-in player ----------
let playerUrl = null;
let playerRec = null;
let playerBlob = null;
const svg = (d, fill) =>
  `<svg viewBox="0 0 24 24" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'}>${d}</svg>`;
const PI = {
  play: svg('<path d="M7 4.5v15l13-7.5z"/>', true),
  pause: svg('<rect x="6" y="4.5" width="4.2" height="15" rx="1"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1"/>', true),
  back: svg('<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4v5h5"/><text x="12" y="15.4" font-size="7.4" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none">10</text>'),
  fwd: svg('<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 4v5h-5"/><text x="12" y="15.4" font-size="7.4" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none">10</text>'),
  vol: svg('<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>'),
  muted: svg('<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>'),
  pip: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="11" width="7" height="5" rx="1" fill="currentColor"/>'),
  full: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  exit: svg('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>'),
  mark: svg('<path d="M6 3.5h12v17l-6-4-6 4z"/>'),
  marked: svg('<path d="M6 3.5h12v17l-6-4-6 4z"/>', true),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  max: svg('<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>'),
  min: svg('<path d="M20 10h-6V4M4 14h6v6M14 10l7-7M10 14l-7 7"/>'),
};
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

function closePlayer() {
  const v = $("pl-video");
  v.pause();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  $("dlg-player").classList.remove("max");
  flushMarks();
  v.removeAttribute("src");
  v.load();
  if (playerUrl) URL.revokeObjectURL(playerUrl);
  playerUrl = null;
  playerRec = null;
  playerBlob = null;
  $("pl-cap").hidden = true;
  if ($("dlg-player").open) $("dlg-player").close();
}
// A transcript being made carries on in the background, so closing never has to ask
const askClosePlayer = closePlayer;
$("pl-close").onclick = askClosePlayer;
$("dlg-player").addEventListener("cancel", (e) => {
  e.preventDefault();
  if (closeSpeakerEdit()) return;
  if (document.fullscreenElement) return;
  if ($("dlg-player").classList.contains("max")) return $("pl-max").click();
  askClosePlayer();
});

// ---------- bookmarks inside the player (with notes) ----------
let marksDirty = false;
let marksTimer = 0;
async function saveMarks(marks) {
  const rec = playerRec;
  if (!rec) return;
  marks.sort((a, b) => a.ms - b.ms);
  rec.bookmarks = marks.map(({ ms, note }) => (note.trim() ? { ms, note: note.trim() } : { ms }));
  marksDirty = true;
  await updateRecord(rec.downloadId, { bookmarks: rec.bookmarks });
}
function saveMarksSoon(marks) {
  clearTimeout(marksTimer);
  marksTimer = setTimeout(() => saveMarks(marks), 400);
}
// Runs when the player closes: save pending notes, refresh the list, and send them to Drive if it's there
function flushMarks() {
  const rec = playerRec;
  const synced = () => rec && syncPackage(rec, true);
  if (marksTimer) {
    clearTimeout(marksTimer);
    marksTimer = 0;
    const marks = [...$("bm-list").children].map((row) => ({ ms: Number(row.dataset.ms), note: row.querySelector(".bm-note").value }));
    saveMarks(marks).then(() => (render(), synced()));
  } else if (marksDirty) render(), synced();
  marksDirty = false;
}

function renderMarks() {
  const list = $("bm-list");
  list.replaceChildren();
  const marks = playerRec ? marksOf(playerRec) : [];
  $("bm-empty").hidden = marks.length > 0;
  $("bm-count").textContent = marks.length ? String(marks.length) : "";
  for (const m of marks) {
    const row = el("div", "bm-row");
    row.dataset.ms = m.ms;
    const t = el("button", "bm-time", `${ICON.bookmark}${fmtDuration(m.ms)}`);
    t.type = "button";
    t.title = "Play from here";
    t.onclick = () => {
      const v = $("pl-video");
      v.currentTime = m.ms / 1000;
      v.play().catch(() => {});
    };
    const note = el("input", "bm-note");
    note.type = "text";
    note.maxLength = 500;
    note.placeholder = "Add a note…";
    note.setAttribute("aria-label", `Note for bookmark at ${fmtDuration(m.ms)}`);
    note.value = m.note;
    note.oninput = () => {
      m.note = note.value;
      saveMarksSoon(marks);
    };
    note.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        note.blur();
      }
    };
    const del = btn(PI.close, "", "btn-ghost bm-del", () => {
      clearTimeout(marksTimer);
      marksTimer = 0;
      marks.splice(marks.indexOf(m), 1);
      saveMarks(marks);
      renderMarks();
    });
    del.type = "button";
    del.title = "Remove bookmark";
    row.append(t, note, del);
    list.append(row);
  }
  paintPlayerTicks();
}

function addMark() {
  if (!playerRec) return;
  const v = $("pl-video");
  const ms = Math.round(v.currentTime * 1000);
  const marks = marksOf(playerRec);
  let m = marks.find((x) => Math.abs(x.ms - ms) < 1000);
  if (!m) {
    clearTimeout(marksTimer);
    marksTimer = 0;
    m = { ms, note: "" };
    marks.push(m);
    saveMarks(marks);
  }
  renderMarks();
  // Type the note straight away (not while the video alone is full screen: the list is hidden then)
  if (document.fullscreenElement !== $("pl-stage")) {
    const input = $("bm-list").querySelector(`[data-ms="${m.ms}"] .bm-note`);
    if (input) input.focus();
  }
}
$("bm-add").onclick = addMark;
// Alt+Shift+B when Chrome handles it as the extension's shortcut (only sent when nothing is recording)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target === "library" && msg.type === "bookmark" && $("dlg-player").open && document.hasFocus()) addMark();
});

let paintPlayerTicks = () => {};
(function wirePlayer() {
  const v = $("pl-video");
  const stage = $("pl-stage");
  const dur = () => (isFinite(v.duration) && v.duration > 0 ? v.duration : playerRec ? playerRec.durationMs / 1000 : 0);
  const clock = (s) => fmtDuration(Math.max(0, s) * 1000);
  const flash = (icon) => {
    const big = $("pl-big");
    big.innerHTML = icon;
    big.hidden = true;
    void big.offsetWidth;
    big.hidden = false;
  };
  const seekBy = (d) => {
    v.currentTime = Math.min(Math.max(0, v.currentTime + d), dur() || Infinity);
    flash(d < 0 ? PI.back : PI.fwd);
  };
  const toggle = () => {
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };
  const paint = () => {
    const d = dur();
    const p = d ? Math.min(1, v.currentTime / d) * 100 : 0;
    $("pl-fill").style.width = p + "%";
    $("pl-knob").style.left = p + "%";
    $("pl-time").textContent = `${clock(v.currentTime)} / ${clock(d)}`;
    $("bm-at").textContent = clock(v.currentTime);
    if (v.buffered.length && d) $("pl-buf").style.width = Math.min(100, (v.buffered.end(v.buffered.length - 1) / d) * 100) + "%";
  };
  paintPlayerTicks = () => {
    const d = dur();
    $("pl-ticks").innerHTML = "";
    if (!d || !playerRec) return;
    for (const { ms, note } of marksOf(playerRec)) {
      const i = document.createElement("i");
      i.style.left = Math.min(100, (ms / 1000 / d) * 100) + "%";
      i.title = "Bookmark " + fmtDuration(ms) + (note ? ": " + note : "");
      $("pl-ticks").append(i);
    }
  };
  $("pl-play").innerHTML = PI.play;
  $("pl-back").innerHTML = PI.back;
  $("pl-fwd").innerHTML = PI.fwd;
  $("pl-mute").innerHTML = PI.vol;
  $("pl-pip").innerHTML = PI.pip;
  $("pl-full").innerHTML = PI.full;
  $("pl-mark").innerHTML = PI.mark;
  $("pl-close").innerHTML = PI.close;
  $("pl-max").innerHTML = PI.max;
  $("bm-add").innerHTML = `${ICON.bookmark}Bookmark <span id="bm-at">0:00:00</span>`;
  $("pl-pip").hidden = !document.pictureInPictureEnabled;

  v.addEventListener("play", () => ($("pl-play").innerHTML = PI.pause));
  v.addEventListener("pause", () => ($("pl-play").innerHTML = PI.play));
  v.addEventListener("ended", () => ($("pl-play").innerHTML = PI.play));
  v.addEventListener("timeupdate", paint);
  v.addEventListener("progress", paint);
  const meta = () => {
    paint();
    paintPlayerTicks();
  };
  v.addEventListener("loadedmetadata", meta);
  v.addEventListener("durationchange", meta);
  v.addEventListener("click", () => {
    toggle();
    flash(v.paused ? PI.play : PI.pause);
  });
  v.addEventListener("dblclick", () => $("pl-full").click());
  $("pl-play").onclick = toggle;
  $("pl-back").onclick = () => seekBy(-10);
  $("pl-fwd").onclick = () => seekBy(10);
  $("pl-mute").onclick = () => (v.muted = !v.muted);
  $("pl-vol").oninput = () => {
    v.volume = Number($("pl-vol").value);
    v.muted = v.volume === 0;
  };
  v.addEventListener("volumechange", () => {
    $("pl-mute").innerHTML = v.muted || v.volume === 0 ? PI.muted : PI.vol;
    $("pl-vol").value = v.muted ? 0 : v.volume;
  });
  $("pl-rate").onclick = () => {
    const i = RATES.indexOf(v.playbackRate);
    v.playbackRate = RATES[(i + 1) % RATES.length];
  };
  v.addEventListener("ratechange", () => ($("pl-rate").textContent = v.playbackRate + "×"));
  $("pl-pip").onclick = () => (document.pictureInPictureElement ? document.exitPictureInPicture() : v.requestPictureInPicture()).catch(() => {});
  // F / the button in the controls: the video alone, full screen
  $("pl-full").onclick = () => (document.fullscreenElement === stage ? document.exitFullscreen() : stage.requestFullscreen()).catch(() => {});
  // The header button: the whole player (video, bookmarks and transcript) fills the screen
  const panel = document.querySelector("#dlg-player .pl");
  const dlg = $("dlg-player");
  $("pl-max").onclick = () => {
    if (document.fullscreenElement === panel) return document.exitFullscreen().catch(() => {});
    if (dlg.classList.contains("max")) return dlg.classList.remove("max"), paintMax();
    panel.requestFullscreen().catch(() => {
      // no Fullscreen API (or it was refused): fill the browser window instead
      dlg.classList.add("max");
      paintMax();
    });
  };
  const paintMax = () => {
    const on = document.fullscreenElement === panel || dlg.classList.contains("max");
    $("pl-max").innerHTML = on ? PI.min : PI.max;
    $("pl-max").title = on ? "Exit full screen" : "Full screen with transcript";
  };
  document.addEventListener("fullscreenchange", () => {
    $("pl-full").innerHTML = document.fullscreenElement === stage ? PI.exit : PI.full;
    paintMax();
  });
  $("pl-mark").onclick = addMark;

  // seek bar: click or drag
  const seek = $("pl-seek");
  const at = (e) => {
    const r = seek.getBoundingClientRect();
    const d = dur();
    if (d) v.currentTime = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * d;
  };
  seek.addEventListener("pointerdown", (e) => {
    seek.setPointerCapture(e.pointerId);
    at(e);
    const mv = (ev) => at(ev);
    const up = () => {
      seek.removeEventListener("pointermove", mv);
      seek.removeEventListener("pointerup", up);
    };
    seek.addEventListener("pointermove", mv);
    seek.addEventListener("pointerup", up);
  });

  // hide the controls while playing and the mouse is still
  let idle;
  const wake = () => {
    stage.classList.remove("idle");
    clearTimeout(idle);
    idle = setTimeout(() => !v.paused && stage.classList.add("idle"), 2500);
  };
  stage.addEventListener("mousemove", wake);
  v.addEventListener("pause", wake);

  // keyboard: arrows/J/L = 10 s (Shift = 30 s), Space/K, M, F, up/down volume, < > speed
  $("dlg-player").addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    const k = e.key.toLowerCase();
    if (k === "arrowleft" || k === "j") seekBy(e.shiftKey ? -30 : -10);
    else if (k === "arrowright" || k === "l") seekBy(e.shiftKey ? 30 : 10);
    else if (k === " " || k === "k") {
      if (e.target.tagName === "BUTTON") return;
      toggle();
    } else if (k === "m") v.muted = !v.muted;
    else if (e.code === "KeyB" && !e.ctrlKey && !e.metaKey) addMark(); // B, or Alt+Shift+B like during a meeting
    else if (k === "f") $("pl-full").click();
    else if (k === "c") $("pl-cc").click();
    else if (k === "arrowup") v.volume = Math.min(1, v.volume + 0.1);
    else if (k === "arrowdown") v.volume = Math.max(0, v.volume - 0.1);
    else if (k === ">") v.playbackRate = RATES[Math.min(RATES.length - 1, Math.max(0, RATES.indexOf(v.playbackRate)) + 1)];
    else if (k === "<") v.playbackRate = RATES[Math.max(0, RATES.indexOf(v.playbackRate) - 1)];
    else return;
    e.preventDefault();
  });
})();

// ---------- transcript (speech-to-text on this PC) ----------
// Transcripts are made in the background (transcriber.js in the recorder's offscreen page, queued by
// background.js), so they keep going when the player or the library is closed. This panel only shows
// the state kept in storage: tr-<id> (done), trp-<id> (progress or error), trQueue and trState.
let trActive = -1;
let trSegs = [];
let trBusy = false;
let trCC = true;
const trKey = (rec) => "tr-" + rec.startedAt;
const stamp = (s) => fmtDuration(s * 1000);
const vttTime = (s) => {
  const ms = Math.round(s * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`;
};
const bgSend = (msg) => chrome.runtime.sendMessage({ target: "background", ...msg }).catch(() => null);

function renderTranscript(segs, busy = false) {
  segs = segs || [];
  for (const k of ["tr-copy", "tr-vtt", "tr-del"]) $(k).hidden = !segs.length || busy;
  // progress updates re-read the same lines: only rebuild the list when it actually grew (or a name changed)
  const names = (l) => l.map((x) => x.sp || "").join("\n");
  const same =
    busy === trBusy &&
    segs.length === trSegs.length &&
    (!segs.length || segs[segs.length - 1].s === trSegs[trSegs.length - 1].s) &&
    names(segs) === names(trSegs);
  trSegs = segs;
  trBusy = busy;
  const has = trSegs.length > 0;
  $("pl-cc").hidden = !has;
  $("pl-cc").classList.toggle("on", has && trCC);
  $("tr-empty").hidden = has || busy;
  const list = $("tr-list");
  list.hidden = !has;
  if (same && list.childElementCount === trSegs.length) return;
  trActive = -1;
  list.replaceChildren();
  // names can be set by hand once the transcript is finished (no names at all: only on hover)
  const named = trSegs.some((x) => x.sp);
  list.classList.toggle("named", named);
  trSegs.forEach((sg, i) => {
    const row = el("div", "tr-line");
    row.dataset.s = sg.s;
    const txt = el("span", "tr-txt");
    if (sg.sp || !busy) {
      const sp = el(busy ? "span" : "button", "tr-sp" + (sg.sp ? "" : " none") + (sg.sp && i && trSegs[i - 1].sp === sg.sp ? " same" : ""), esc(sg.sp || "+ Name"));
      if (!busy) {
        sp.type = "button";
        sp.title = sg.sp ? "Change who said this" : "Say who said this";
        sp.onclick = (e) => {
          e.stopPropagation();
          editSpeaker(i, row);
        };
      }
      txt.append(sp);
    }
    txt.append(document.createTextNode(sg.t));
    row.append(el("b", "", stamp(sg.s)), txt);
    row.onclick = () => {
      const v = $("pl-video");
      v.currentTime = sg.s;
      v.play().catch(() => {});
    };
    list.append(row);
  });
  syncCaption();
}

// ---------- speaker names, set or changed by hand ----------
// Opens a small editor under the line: a name (suggestions from the other lines), and for a line that
// already has a name, whether to rename every line with that name (e.g. all of "You" -> "Siril").
let spkEdit = null; // the open editor element

function closeSpeakerEdit() {
  if (!spkEdit) return false;
  spkEdit.remove();
  spkEdit = null;
  return true;
}

function editSpeaker(i, row) {
  closeSpeakerEdit();
  const old = trSegs[i].sp || null;
  const known = [...new Set(trSegs.map((x) => x.sp).filter(Boolean))];
  const box = el("div", "tr-sp-edit");
  box.onclick = (e) => e.stopPropagation();
  const input = document.createElement("input");
  input.className = "tr-sp-in";
  input.placeholder = "Who said this?";
  input.maxLength = 60;
  input.value = old || "";
  const chips = el("div", "tr-sp-chips");
  for (const n of known)
    if (n !== old) {
      const c = el("button", "tr-sp-chip", esc(n));
      c.type = "button";
      c.onclick = () => save(n);
      chips.append(c);
    }
  const count = old ? trSegs.filter((x) => x.sp === old).length : 0;
  const all = document.createElement("label");
  all.className = "tr-sp-all";
  const allBox = document.createElement("input");
  allBox.type = "checkbox";
  allBox.checked = count > 1;
  all.append(allBox, document.createTextNode(` Every line by “${old}” (${count})`));
  all.hidden = count < 2;
  const btns = el("div", "tr-sp-btns");
  const mk = (label, cls, fn) => {
    const b = el("button", "btn " + cls, label);
    b.type = "button";
    b.onclick = fn;
    btns.append(b);
  };
  if (old) mk("Remove name", "", () => save(null));
  btns.append(el("span", "spacer"));
  mk("Cancel", "", closeSpeakerEdit);
  mk("Save", "btn-primary", () => save(input.value));
  input.onkeydown = (e) => {
    if (e.key === "Enter") save(input.value);
    else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeSpeakerEdit();
    }
  };
  box.append(input, chips, all, btns);
  if (!chips.childElementCount) chips.hidden = true;
  row.append(box);
  spkEdit = box;
  input.focus();
  input.select();

  async function save(name) {
    name = (name || "").trim().slice(0, 60) || null;
    closeSpeakerEdit();
    if (name === old && !(name && allBox.checked)) return;
    const every = old && allBox.checked && count > 1;
    // null (not missing) so the line isn't given a name again from the recording
    const segs = trSegs.map((x, j) => (j === i || (every && x.sp === old) ? { ...x, sp: name } : x));
    await saveSpeakers(segs);
  }
}

async function saveSpeakers(segs) {
  const rec = playerRec;
  if (!rec) return;
  const key = trKey(rec);
  const cur = (await chrome.storage.local.get(key))[key];
  if (!cur) return;
  await chrome.storage.local.set({ [key]: { ...cur, segments: segs } }); // the storage listener re-renders
  bgSend({ type: "tr-files", id: rec.startedAt }); // the .txt / .vtt in Downloads
  if (rec.uploaded) syncPackage(rec, true);
}

async function loadTranscript(rec) {
  const id = rec.startedAt;
  const got = await chrome.storage.local.get([trKey(rec), "trp-" + id, "trQueue", "trState"]);
  if (playerRec !== rec) return;
  const done = got[trKey(rec)];
  const prog = got["trp-" + id];
  const ahead = (got.trQueue || []).findIndex((x) => x.id === id);
  const st = got.trState && got.trState.id === id ? got.trState : null;
  const state = (t) => ($("tr-state").textContent = t);
  $("tr-pending").hidden = true;
  $("tr-bar").hidden = !st;
  if (st) $("tr-fill").style.width = (st.pct || 0) + "%";
  if (ahead >= 0) {
    // waiting or being made: show the lines found so far
    renderTranscript(labelSpeakers((prog && prog.segments) || [], rec.speakers), true);
    $("tr-gen").textContent = "Cancel";
    if (st) state(st.text || "Working…");
    else if (ahead === 0) state("Starting…");
    else state(`Waiting for ${ahead} other recording${ahead > 1 ? "s" : ""}…`);
  } else if (done) {
    // an imported recording that now has its transcript (fetched, or made here) is no longer pending
    if (rec.imported && rec.imported.trStatus === "in-progress") {
      rec.imported = { ...rec.imported, trStatus: "done" };
      updateRecord(rec.downloadId, { imported: rec.imported }).then(() => render());
    }
    renderTranscript(done.segments);
    state(done.segments && done.segments.length ? `${done.segments.length} lines` : "No speech was found.");
    $("tr-gen").textContent = "Redo";
  } else if (rec.imported && rec.imported.trStatus === "in-progress") {
    // Imported while the sender's transcript was still being made
    renderTranscript([]);
    state("");
    $("tr-gen").textContent = "Make my own";
    $("tr-pending-text").textContent = `The sender's transcript was still being made (${rec.imported.trPct || 0}%) when you imported this.`;
    $("tr-fetch").hidden = !rec.imported.source;
    if (!rec.imported.source) $("tr-pending-text").textContent += " Import it again once they've finished, or make your own.";
    $("tr-pending").hidden = false;
    $("tr-empty").hidden = true;
  } else {
    renderTranscript([]);
    state(prog && prog.error ? "Failed: " + prog.error : "");
    $("tr-gen").textContent = prog && prog.error ? "Try again" : "Generate transcript";
  }
}

// Put a recording in the background transcript queue, next after the one running now.
// Older recordings have no copy inside the extension: give the background one to read.
async function queueTranscript(rec, getBlob) {
  if (!(await keptFile(rec))) {
    const blob = await getBlob();
    if (!blob) throw new Error("The video file was not found.");
    const root = await navigator.storage.getDirectory();
    const h = await root.getFileHandle(`trsrc-${rec.startedAt}.${extOf(rec)}`, { create: true });
    await blob.stream().pipeTo(await h.createWritable());
  }
  await bgSend({ type: "tr-add", id: rec.startedAt, ext: extOf(rec), front: true });
}

// The transcript button on a card: same as Generate in the player, without opening it
async function transcribeFromCard(rec, item, b) {
  b.disabled = true;
  try {
    await queueTranscript(rec, () => readLocalFile(rec, item));
    toast(`Making a transcript of "${rec.name}" in the background`);
  } catch (e) {
    if (e.name !== "AbortError") toast(`Could not start the transcript: ${e.message}`, true);
  } finally {
    b.disabled = false;
    paintTrChips();
  }
}

// Start (or cancel) a transcript of the open recording
$("tr-gen").onclick = async () => {
  const rec = playerRec;
  if (!rec) return;
  const gen = $("tr-gen");
  gen.disabled = true;
  try {
    const { trQueue = [] } = await chrome.storage.local.get("trQueue");
    if (trQueue.some((x) => x.id === rec.startedAt)) {
      await bgSend({ type: "tr-cancel", id: rec.startedAt });
      return;
    }
    if (!(await keptFile(rec))) $("tr-state").textContent = "Preparing…";
    await queueTranscript(rec, () => playerBlob);
  } catch (e) {
    $("tr-state").textContent = "Couldn't start: " + e.message;
  } finally {
    gen.disabled = false;
    if (playerRec === rec) loadTranscript(rec);
  }
};

// Live updates from the background job, for the open player and the list
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (playerRec) {
    const id = playerRec.startedAt;
    if (changes.trQueue || changes.trState || changes["tr-" + id] || changes["trp-" + id]) loadTranscript(playerRec);
  }
  if (changes.trQueue || changes.trState || Object.keys(changes).some((k) => /^trp?-\d+$/.test(k))) paintTrChips();
});

// On the cards: "Transcribing 40%" / "Transcript queued" while it's being made, the Transcript badge once
// it's done, and the transcript button only when there is neither (also after a failed try)
async function paintTrChips() {
  const ids = [...new Set([...document.querySelectorAll("[data-tr]")].map((c) => +c.dataset.tr))];
  const got = await chrome.storage.local.get(["trQueue", "trState", ...ids.flatMap((id) => ["tr-" + id, "trp-" + id])]);
  const { trQueue = [], trState } = got;
  for (const id of ids) {
    const at = trQueue.findIndex((x) => x.id === id);
    const done = !!got["tr-" + id];
    const failed = !!(got["trp-" + id] && got["trp-" + id].error);
    for (const c of document.querySelectorAll(`[data-tr="${id}"]`)) {
      c.hidden = at < 0;
      if (at < 0) continue;
      if (trState && trState.id === id)
        c.textContent = trState.phase === "paused" ? "Transcript paused" : trState.phase === "transcribing" ? `Transcribing ${trState.pct}%` : "Transcribing…";
      else c.textContent = "Transcript queued";
    }
    for (const c of document.querySelectorAll(`[data-trdone="${id}"]`)) c.hidden = !done || at >= 0;
    for (const b of document.querySelectorAll(`[data-trbtn="${id}"]`)) {
      b.hidden = done || at >= 0;
      b.title = failed ? `Transcript failed: ${got["trp-" + id].error}. Try again` : "Make a transcript";
    }
  }
}

$("tr-copy").onclick = async () => {
  await navigator.clipboard.writeText(trSegs.map((x) => `[${stamp(x.s)}] ${speakerText(x)}`).join("\n"));
  toast("Transcript copied");
};
$("tr-vtt").onclick = () => {
  const body = "WEBVTT\n\n" + trSegs.map((x, i) => `${i + 1}\n${vttTime(x.s)} --> ${vttTime(x.e)}\n${vttVoice(x)}\n`).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([body], { type: "text/vtt" }));
  a.download = (playerRec ? playerRec.name : "transcript") + ".vtt";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$("tr-del").onclick = async () => {
  if (!playerRec || !confirm("Delete this transcript?")) return;
  await chrome.storage.local.remove(trKey(playerRec));
  loadTranscript(playerRec);
  syncPackage(playerRec, true);
};
$("pl-cc").onclick = () => {
  trCC = !trCC;
  $("pl-cc").classList.toggle("on", trCC);
  syncCaption();
};

// live caption + highlighted line while playing

function syncCaption() {
  const v = $("pl-video");
  const t = v.currentTime;
  let idx = -1;
  for (let i = 0; i < trSegs.length; i++) {
    if (trSegs[i].s <= t + 0.05 && t <= Math.max(trSegs[i].e, trSegs[i].s + 1.5)) idx = i;
    if (trSegs[i].s > t) break;
  }
  const cap = $("pl-cap");
  if (idx >= 0 && trCC) {
    cap.replaceChildren(el("span", "", esc(speakerText(trSegs[idx]))));
    cap.hidden = false;
  } else cap.hidden = true;
  if (idx !== trActive) {
    const rows = $("tr-list").children;
    if (rows[trActive]) rows[trActive].classList.remove("on");
    trActive = idx;
    if (rows[idx]) {
      rows[idx].classList.add("on");
      const list = $("tr-list");
      if (!v.paused) list.scrollTop = rows[idx].offsetTop - list.offsetTop - list.clientHeight / 3;
    }
  }
}
$("pl-video").addEventListener("timeupdate", syncCaption);
$("pl-video").addEventListener("seeked", syncCaption);

async function playRecording(rec, item, startAt) {
  const dlg = $("dlg-player");
  $("pl-title").textContent = rec.name;
  $("pl-sub").textContent = `${fmtDateTime(rec.startedAt)} · ${fmtDuration(rec.durationMs)}`;
  $("pl-msg").textContent = "";
  $("pl-sys").onclick = () => item && chrome.downloads.open(rec.downloadId);
  $("pl-sys").hidden = !item;
  const v = $("pl-video");
  playerRec = rec;
  v.removeAttribute("src");
  trSegs = [];
  loadTranscript(rec);
  renderMarks();
  try {
    // The copy kept inside the extension if there is one, else the file in Downloads (asks once for access)
    const blob = (await keptFile(rec)) || (item ? await readLocalFile(rec, item) : null);
    if (!blob) throw new Error("The video file was not found.");
    if (playerUrl) URL.revokeObjectURL(playerUrl);
    playerBlob = blob;
    playerUrl = URL.createObjectURL(blob);
    v.src = playerUrl;
    v.onloadedmetadata = () => {
      if (startAt) v.currentTime = startAt;
      v.play().catch(() => {});
    };
    v.onerror = () => ($("pl-msg").textContent = "This file can't be played in the browser. Use “Open in system player”.");
    if (!dlg.open) dlg.showModal();
  } catch (e) {
    if (e.name === "AbortError") return;
    if (item) chrome.downloads.open(rec.downloadId); // fall back to the system player
    else toast(e.message, true);
  }
}

$("search").oninput = () => render();
renderDriveBtn();
checkScript();
pruneKept().then(showRecover);
bgSend({ type: "tr-kick" }); // carries on a transcript that was interrupted (e.g. the browser closed)
runCleanup().then((n) => n && render()).catch(() => {});
render();
chrome.downloads.onChanged.addListener(() => render());
