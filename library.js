const $ = (id) => document.getElementById(id);

const ICON = {
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

function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${Math.floor(s / 3600)}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
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
    const { email } = await driveScriptCall(conn, { action: "ping" });
    await chrome.storage.local.set({ driveConn: { ...conn, email } });
    $("script-url").value = conn.url; // may be the company (/a/macros/…) link
    connectMsg(`Connected ✓ Uploads go to ${email || "your Drive"}`, "ok");
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
    const wanted = new Set(recs.filter((r) => !r.uploaded).map((r) => `keep-${r.startedAt}.${extOf(r)}`));
    const root = await navigator.storage.getDirectory();
    for await (const [name, h] of root.entries()) {
      if (!name.startsWith("keep-")) continue;
      const age = Date.now() - parseInt(name.slice(5), 10);
      if (!wanted.has(name) || !(age < KEEP_DAYS * 864e5)) await root.removeEntry(name).catch(() => {});
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
    uploading.set(id, 0);
    showProgress(id);
    const out = await driveUploadViaScript(conn, blob, fileName, folder, (p) => {
      uploading.set(id, p);
      showProgress(id);
    });
    uploading.delete(id);
    if (conn.url !== oldUrl) await chrome.storage.local.set({ driveConn: conn });
    await updateRecord(id, { uploaded: true, driveUrl: out.fileUrl, folderUrl: out.folderUrl });
    dropKept(rec);
    toast(`"${rec.name}" uploaded to Google Drive → ${folder}`);
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
  m.append(item(ICON.link, "Open on Drive", "", () => (window.open(rec.driveUrl, "_blank"), closeMenu())));
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
  if (rec.folderUrl) m.append(item(ICON.folder, "Open Drive folder", "", () => (window.open(rec.folderUrl, "_blank"), closeMenu())));
  m.append(el("div", "mh", "Who can view"));
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
        if (!fileId || !getConnCache) throw new Error("Connect your Google Drive first");
        await driveShare(getConnCache, fileId, key);
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
  if (rec.uploaded) name.append(el("span", "chip ok", "On Drive"));
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
    for (const ms of rec.bookmarks) {
      const m = el("button", "mark", `${ICON.bookmark}${fmtDuration(ms)}`);
      m.title = "Play from here";
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
      `<div class="rt"><b>Unfinished recording found</b><span>${esc(u.meta ? u.meta.name : "Meeting")} · ${new Date(u.started).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} · ${fmtSize(u.file.size)}. It was cut short, you can still save what was recorded.</span></div>`
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
};
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

function closePlayer() {
  const v = $("pl-video");
  v.pause();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  v.removeAttribute("src");
  v.load();
  if (playerUrl) URL.revokeObjectURL(playerUrl);
  playerUrl = null;
  playerRec = null;
  playerBlob = null;
  stopTranscribe();
  $("pl-cap").hidden = true;
  if ($("dlg-player").open) $("dlg-player").close();
}
$("pl-close").onclick = () => {
  if (trWorker && !confirm("The transcript is still being made. Stop it and close?")) return;
  closePlayer();
};
$("dlg-player").addEventListener("cancel", (e) => {
  e.preventDefault();
  if (document.fullscreenElement) return;
  closePlayer();
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
    if (v.buffered.length && d) $("pl-buf").style.width = Math.min(100, (v.buffered.end(v.buffered.length - 1) / d) * 100) + "%";
  };
  paintPlayerTicks = () => {
    const d = dur();
    $("pl-ticks").innerHTML = "";
    if (!d || !playerRec) return;
    for (const ms of playerRec.bookmarks || []) {
      const i = document.createElement("i");
      i.style.left = Math.min(100, (ms / 1000 / d) * 100) + "%";
      i.title = "Bookmark " + fmtDuration(ms);
      $("pl-ticks").append(i);
    }
  };
  $("pl-play").innerHTML = PI.play;
  $("pl-back").innerHTML = PI.back;
  $("pl-fwd").innerHTML = PI.fwd;
  $("pl-mute").innerHTML = PI.vol;
  $("pl-pip").innerHTML = PI.pip;
  $("pl-full").innerHTML = PI.full;
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
  $("pl-full").onclick = () => (document.fullscreenElement ? document.exitFullscreen() : stage.requestFullscreen()).catch(() => {});
  document.addEventListener("fullscreenchange", () => ($("pl-full").innerHTML = document.fullscreenElement ? PI.exit : PI.full));

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
let trWorker = null;
let trActive = -1;
let trSegs = [];
let trCC = true;
const trKey = (rec) => "tr-" + rec.startedAt;
const stamp = (s) => fmtDuration(s * 1000);
const vttTime = (s) => {
  const ms = Math.round(s * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`;
};

function renderTranscript(segs) {
  trSegs = segs || [];
  trActive = -1;
  const list = $("tr-list");
  list.replaceChildren();
  const has = trSegs.length > 0;
  list.hidden = !has;
  $("pl-cc").hidden = !has;
  $("pl-cc").classList.toggle("on", has && trCC);
  for (const k of ["tr-copy", "tr-vtt", "tr-del"]) $(k).hidden = !has || !!trWorker;
  for (const sg of trSegs) {
    const row = el("div", "tr-line");
    row.dataset.s = sg.s;
    row.append(el("b", "", stamp(sg.s)), el("span", "", sg.t));
    row.onclick = () => {
      const v = $("pl-video");
      v.currentTime = sg.s;
      v.play().catch(() => {});
    };
    list.append(row);
  }
}

async function loadTranscript(rec) {
  renderTranscript([]);
  $("tr-state").textContent = "";
  $("tr-bar").hidden = true;
  $("tr-gen").hidden = false;
  $("tr-gen").textContent = "Generate transcript";
  const got = (await chrome.storage.local.get(trKey(rec)))[trKey(rec)];
  if (playerRec !== rec) return;
  if (got && got.segments && got.segments.length) {
    renderTranscript(got.segments);
    $("tr-state").textContent = `${got.segments.length} lines`;
    $("tr-gen").textContent = "Redo";
  } else if (got) {
    $("tr-state").textContent = "No speech was found.";
  }
}

function stopTranscribe() {
  if (trWorker) {
    trWorker.terminate();
    trWorker = null;
  }
  $("tr-bar").hidden = true;
}

async function decodeMono16k(blob) {
  const ctx = new AudioContext({ sampleRate: 16000 });
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const n = buf.numberOfChannels;
    const out = new Float32Array(buf.length);
    for (let c = 0; c < n; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) out[i] += d[i] / n;
    }
    return out;
  } finally {
    ctx.close();
  }
}

async function generateTranscript() {
  if (trWorker) {
    // the button doubles as Cancel while running
    stopTranscribe();
    $("tr-state").textContent = "Stopped.";
    $("tr-gen").textContent = trSegs.length ? "Redo" : "Generate transcript";
    renderTranscript(trSegs);
    return;
  }
  const rec = playerRec;
  const blob = playerBlob;
  if (!rec || !blob) return;
  const s = await getSettings();
  const state = (t) => ($("tr-state").textContent = t);
  $("tr-gen").textContent = "Cancel";
  $("tr-bar").hidden = false;
  $("tr-fill").style.width = "0%";
  for (const k of ["tr-copy", "tr-vtt", "tr-del"]) $(k).hidden = true;
  try {
    state("Reading the audio…");
    const audio = await decodeMono16k(blob);
    if (playerRec !== rec) return;
    const w = new Worker("transcribe-worker.js", { type: "module" });
    trWorker = w;
    renderTranscript([]);
    w.onmessage = async (e) => {
      const m = e.data;
      if (trWorker !== w) return;
      if (m.type === "status") state(m.text);
      else if (m.type === "download") {
        const pct = m.total ? Math.round((m.loaded / m.total) * 100) : 0;
        state(`Downloading the speech model (once)… ${pct}%`);
        $("tr-fill").style.width = pct + "%";
      } else if (m.type === "progress") {
        $("tr-fill").style.width = Math.round((m.done / m.total) * 100) + "%";
        state(`Transcribing… ${Math.round((m.done / m.total) * 100)}%`);
        renderTranscript(m.segments);
        for (const k of ["tr-copy", "tr-vtt", "tr-del"]) $(k).hidden = true;
      } else if (m.type === "done") {
        stopTranscribe();
        await chrome.storage.local.set({
          [trKey(rec)]: { model: s.transcriptModel, lang: s.transcriptLang, at: Date.now(), segments: m.segments },
        });
        if (playerRec === rec) loadTranscript(rec);
      } else if (m.type === "error") {
        stopTranscribe();
        state("Failed: " + m.message);
        $("tr-gen").textContent = "Try again";
      }
    };
    w.onerror = (e) => {
      stopTranscribe();
      state("Failed: " + (e.message || "the speech engine could not start"));
      $("tr-gen").textContent = "Try again";
    };
    w.postMessage({ type: "run", audio, model: s.transcriptModel, language: s.transcriptLang }, [audio.buffer]);
  } catch (e) {
    stopTranscribe();
    state("Couldn't read this recording's audio: " + e.message);
    $("tr-gen").textContent = "Try again";
  }
}

$("tr-gen").onclick = generateTranscript;
$("tr-copy").onclick = async () => {
  await navigator.clipboard.writeText(trSegs.map((x) => `[${stamp(x.s)}] ${x.t}`).join("\n"));
  toast("Transcript copied");
};
$("tr-vtt").onclick = () => {
  const body = "WEBVTT\n\n" + trSegs.map((x, i) => `${i + 1}\n${vttTime(x.s)} --> ${vttTime(x.e)}\n${x.t}\n`).join("\n");
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
    cap.replaceChildren(el("span", "", trSegs[idx].t));
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
  $("pl-sub").textContent = `${new Date(rec.startedAt).toLocaleString()} · ${fmtDuration(rec.durationMs)}`;
  $("pl-msg").textContent = "";
  $("pl-sys").onclick = () => item && chrome.downloads.open(rec.downloadId);
  $("pl-sys").hidden = !item;
  const v = $("pl-video");
  playerRec = rec;
  v.removeAttribute("src");
  // bookmark chips jump inside the open player
  stopTranscribe();
  loadTranscript(rec);
  const box = $("pl-marks");
  box.replaceChildren();
  box.hidden = !(rec.bookmarks && rec.bookmarks.length);
  for (const ms of rec.bookmarks || []) {
    const b = el("button", "", `${ICON.bookmark}${fmtDuration(ms)}`);
    b.type = "button";
    b.onclick = () => {
      v.currentTime = ms / 1000;
      v.play().catch(() => {});
    };
    box.append(b);
  }
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
pruneKept().then(showRecover);
runCleanup().then((n) => n && render()).catch(() => {});
render();
chrome.downloads.onChanged.addListener(() => render());
