// Google Drive helpers shared by the recorder (auto-upload) and the library page (manual upload).
// Scope is drive.file, so only files/folders created by this extension are visible to it.
const DRIVE_CHUNK = 8 * 1024 * 1024; // multiple of 256 KiB
const DRIVE_ROOT_NAME = "Meet Recordings";

async function driveApi(token, url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`Drive error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function driveFindOrCreateFolder(token, name, parentId) {
  const q = [
    `name='${name.replace(/'/g, "\\'")}'`,
    "mimeType='application/vnd.google-apps.folder'",
    "trashed=false",
    parentId ? `'${parentId}' in parents` : "'root' in parents",
  ].join(" and ");
  const found = await driveApi(
    token,
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`
  );
  if (found.files && found.files.length) return found.files[0].id;
  const created = await driveApi(token, "https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  return created.id;
}

// "Meet Recordings" / "2026-09-25", created if missing
async function driveDayFolder(token, dateName) {
  const root = await driveFindOrCreateFolder(token, DRIVE_ROOT_NAME, null);
  return driveFindOrCreateFolder(token, dateName, root);
}

// Anyone with the link can view (the folder is not listed publicly; files inherit it)
async function driveMakePublic(token, fileId) {
  await driveApi(token, `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: "POST",
    body: JSON.stringify({ role: "reader", type: "anyone" }),
  });
}

async function driveUploadFile(token, blob, name, folderId, onProgress) {
  const init = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/webm",
        "X-Upload-Content-Length": String(blob.size),
      },
      body: JSON.stringify({ name, mimeType: "video/webm", ...(folderId ? { parents: [folderId] } : {}) }),
    }
  );
  if (!init.ok) throw new Error(`Could not start upload (${init.status}): ${await init.text()}`);
  return driveSendToSession(init.headers.get("Location"), blob, onProgress);
}

// Send a file to a resumable upload session in 8 MB pieces. Returns { id, webViewLink }.
async function driveSendToSession(sessionUrl, blob, onProgress) {
  let offset = 0;
  let file = null;
  while (offset < blob.size) {
    const end = Math.min(offset + DRIVE_CHUNK, blob.size);
    // Retry a failed chunk (network blip / 5xx) instead of losing a big upload
    let res;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await fetch(sessionUrl, {
          method: "PUT",
          headers: { "Content-Range": `bytes ${offset}-${end - 1}/${blob.size}` },
          body: blob.slice(offset, end),
        });
        if (res.status < 500 || attempt >= 5) break;
      } catch (e) {
        if (attempt >= 5) throw e;
      }
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
    if (res.status === 308) offset = end;
    else if (res.ok) {
      offset = blob.size;
      file = await res.json();
    } else throw new Error(`Upload failed (${res.status}): ${await res.text()}`);
    if (onProgress) onProgress(Math.round((offset / blob.size) * 100));
  }
  return file; // { id, webViewLink }
}

// ---------- "Connect my Drive" (Apps Script in the user's own account, no client ID needed) ----------
// The script only starts an upload in the user's Drive; the video bytes go straight to Google.
const DRIVE_SCRIPT = `// Meet Recorder -> your Google Drive.
// Runs in YOUR Google account only. It can only start uploads, and only with the key below.
const KEY = "__KEY__";
const ROOT = "Meet Recordings";
const VERSION = 2; // 2: one folder per recording (video + transcript + notes), folder sharing, import from a link

function doPost(e) {
  let out;
  try {
    const req = JSON.parse(e.postData.contents);
    if (req.key !== KEY) throw new Error("Wrong key. Copy the script from the extension again.");
    if (req.action === "ping") {
      // Also checks the upload permission, so a missing one shows up at Connect time
      UrlFetchApp.fetch("https://www.googleapis.com/drive/v3/about?fields=user", {
        headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
        muteHttpExceptions: true,
      });
      out = { ok: true, email: Session.getEffectiveUser().getEmail(), v: VERSION };
    }
    else if (req.action === "start") out = startUpload(req);
    else if (req.action === "share") out = shareFile(req);
    else if (req.action === "readFolder") out = readFolder(req);
    else if (req.action === "token") out = { ok: true, token: ScriptApp.getOAuthToken() };
    else throw new Error("Unknown action");
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// Run this once from the editor (select "authorize" and click Run) so Google asks for all
// permissions: Drive + "connect to an external service" (needed to start uploads).
function authorize() {
  DriveApp.getRootFolder();
  UrlFetchApp.fetch("https://www.googleapis.com/drive/v3/about?fields=user", {
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  Logger.log("All set. Now deploy it as a Web app.");
}

// Who can open the file (or a recording's folder): private | domain (my organization) | anyone (with the link)
function shareFile(req) {
  const A = DriveApp.Access;
  const access = { private: A.PRIVATE, domain: A.DOMAIN_WITH_LINK, anyone: A.ANYONE_WITH_LINK }[req.access];
  if (!access) throw new Error("Unknown access");
  const item = req.folderId ? DriveApp.getFolderById(req.folderId) : DriveApp.getFileById(req.fileId);
  item.setSharing(access, DriveApp.Permission.VIEW);
  return { ok: true };
}

// Import: a Meet Recorder folder someone shared with you (or a date folder holding several).
// Returns each recording's info file and its videos, plus a short-lived key the extension uses
// to download the video straight from Google to your PC.
function readFolder(req) {
  let dir;
  try {
    dir = DriveApp.getFolderById(req.id);
  } catch (e) {
    const parents = DriveApp.getFileById(req.id).getParents(); // a file link: use its folder
    if (!parents.hasNext()) throw new Error("Share the folder link, not a file link.");
    dir = parents.next();
  }
  const packages = [];
  const scan = (d, depth) => {
    const files = [];
    const it = d.getFiles();
    while (it.hasNext()) files.push(it.next());
    const videos = files
      .filter((f) => /\\.(mp4|webm)$/i.test(f.getName()))
      .map((f) => ({ id: f.getId(), name: f.getName(), size: f.getSize() }));
    files
      .filter((f) => /\\.meetrec\\.json$/i.test(f.getName()))
      .forEach((f) => packages.push({ meta: f.getBlob().getDataAsString(), videos: videos }));
    if (depth > 0) {
      const sub = d.getFolders();
      while (sub.hasNext()) scan(sub.next(), depth - 1);
    }
  };
  scan(dir, 1);
  return { ok: true, name: dir.getName(), packages: packages, token: ScriptApp.getOAuthToken() };
}

function folder(name, parent) {
  const found = parent.getFoldersByName(name);
  return found.hasNext() ? found.next() : parent.createFolder(name);
}

// Where the file goes: an existing folder (folderId), else Meet Recordings / path... (or / folder)
function startUpload(req) {
  let dir;
  if (req.folderId) dir = DriveApp.getFolderById(req.folderId);
  else {
    dir = folder(ROOT, DriveApp.getRootFolder());
    const path = req.path || (req.folder ? [req.folder] : []);
    for (let i = 0; i < path.length; i++) if (path[i]) dir = folder(String(path[i]), dir);
  }
  // Updating the transcript / notes: the old copy goes to the bin
  if (req.replace) {
    const old = dir.getFilesByName(req.name);
    while (old.hasNext()) old.next().setTrashed(true);
  }
  const res = UrlFetchApp.fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink", {
      method: "post",
      contentType: "application/json; charset=UTF-8",
      headers: {
        Authorization: "Bearer " + ScriptApp.getOAuthToken(),
        "X-Upload-Content-Type": req.mime || "video/webm",
        "X-Upload-Content-Length": String(req.size),
      },
      payload: JSON.stringify({ name: req.name, parents: [dir.getId()] }),
      muteHttpExceptions: true,
    });
  const h = res.getHeaders();
  const uploadUrl = h.Location || h.location;
  if (!uploadUrl) throw new Error("Drive refused the upload: " + res.getContentText());
  return { ok: true, uploadUrl: uploadUrl, folderUrl: dir.getUrl(), folderId: dir.getId(), v: VERSION };
}
`;

async function driveScriptCall(conn, body) {
  const payload = JSON.stringify({ key: conn.key, ...body });
  const post = async (url, credentials) => {
    const r = await fetch(url, { method: "POST", credentials, body: payload });
    return [r, await r.text()];
  };
  const call = async (credentials) => {
    let [res, text] = await post(conn.url, credentials);
    // Work (Workspace) accounts: Google forwards /macros/s/… to /a/macros/<domain>/s/…, and the
    // forward turns the POST into a GET ("Script function not found: doGet"). Post to the real link.
    if (res.redirected && /function not found: doGet/i.test(text)) {
      const direct = res.url.split("?")[0];
      if (/^https:\/\/script\.google\.com\/a\/macros\/.+\/exec$/.test(direct) && direct !== conn.url) {
        [res, text] = await post(direct, credentials);
        conn.url = direct; // remembered by the caller when saving the connection
      }
    }
    let out = null;
    try {
      out = JSON.parse(text);
    } catch {}
    return [res, text, out];
  };
  // Without the Chrome Google login first: with several signed-in accounts Google often
  // answers 404 / "unable to open the file". The login is only needed for "Anyone within <company>".
  let [res, text, out] = await call("omit");
  if (!out) {
    const retry = await call("include");
    if (retry[2]) [res, text, out] = retry;
  }
  if (!out) {
    // Show what Google answered (e.g. a sign-in page or a script error page) to make it fixable
    // (the background worker has no DOMParser: strip the tags there)
    const doc = typeof DOMParser !== "undefined" ? new DOMParser().parseFromString(text, "text/html") : null;
    const said = (doc ? (doc.title || "") + " " + (doc.body ? doc.body.innerText : "") : text.replace(/<[^>]*>/g, " "))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
    if (res.status === 404)
      throw new Error(
        "Google can't find the script link (it changes when you make a New deployment). " +
          "In the script open Deploy → Manage deployments, copy the Web app URL of the active one and paste it in Connect Google Drive. " +
          `Google said: "${said || "nothing"}"`
      );
    if (res.status === 401 || res.status === 403 || /accounts\.google\.com/.test(res.url))
      throw new Error(
        "The script does not allow access. In Deploy → Manage deployments set Who has access to Anyone (or Anyone within your company) and deploy again."
      );
    if (/sign in|accounts\.google/i.test(said + res.url))
      throw new Error(
        "Google asked to sign in: the script's Who has access is not Anyone. Set it to Anyone (or Anyone within your company) with ✏️ → New version → Deploy."
      );
    throw new Error(
      `The link did not answer like the Meet Recorder script (${res.status}). Google said: "${said || "nothing"}"`
    );
  }
  if (!out.ok) throw new Error(out.error || "Script error");
  return out;
}

const DRIVE_OLD_SCRIPT =
  "Your Drive script is older. Open Connect Google Drive, copy the code again, paste it over the old one in the script editor, save, then Deploy → Manage deployments → ✏️ → New version → Deploy.";

// Change who can open an uploaded file, or a recording's whole folder (needs the newer script)
async function driveShare(conn, target, access) {
  try {
    await driveScriptCall(conn, { action: "share", ...target, access });
  } catch (e) {
    if (/Unknown action/i.test(e.message)) throw new Error(DRIVE_OLD_SCRIPT);
    throw e;
  }
}

// Upload through the user's own script: Drive > Meet Recordings > folderName
async function driveUploadViaScript(conn, blob, name, folderName, onProgress) {
  const { uploadUrl, folderUrl } = await driveScriptCall(conn, {
    action: "start",
    name,
    folder: folderName,
    size: blob.size,
    mime: blob.type || "video/webm",
  });
  const file = await driveSendToSession(uploadUrl, blob, onProgress);
  return { fileUrl: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`, folderUrl };
}

// ---------- Share package: video + transcript + notes, one Drive folder per recording ----------
// Drive > Meet Recordings > <folder> > <video name without extension> >
//   <base>.mp4               the recording
//   <base> transcript.txt    readable transcript (when there is one)
//   <base>.meetrec.json      name, date, length, bookmarks + notes, transcript: what Import reads back
const PKG_FORMAT = "meet-recorder";
const PKG_VERSION = 1;
const PKG_SUFFIX = ".meetrec.json";

const pkgBase = (videoName) => videoName.replace(/\.[^.]+$/, "");

function pkgClock(ms) {
  const s = Math.round(ms / 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${Math.floor(s / 3600)}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

function pkgMarks(rec) {
  return (rec.bookmarks || []).map((b) => (typeof b === "number" ? { ms: b, note: "" } : { ms: b.ms, note: b.note || "" }));
}

// transcript: what the library stores as tr-<startedAt> ({ model, lang, at, segments }) or null.
// trPct: how far a transcript that is being made right now has got (0-100), else null.
function pkgTrStatus(transcript, trPct) {
  if (transcript && transcript.segments && transcript.segments.length) return "done";
  return trPct != null ? "in-progress" : "none";
}

function pkgMeta(rec, videoName, transcript, by, trPct) {
  const segs = transcript && transcript.segments && transcript.segments.length ? transcript : null;
  const status = pkgTrStatus(transcript, trPct);
  return {
    format: PKG_FORMAT,
    version: PKG_VERSION,
    name: rec.name,
    recordedAt: new Date(rec.startedAt).toISOString(),
    startedAt: rec.startedAt,
    durationMs: rec.durationMs,
    mode: rec.mode || "tab",
    video: videoName,
    ext: rec.ext === "mp4" ? "mp4" : "webm",
    size: rec.size,
    recordedBy: (rec.imported && rec.imported.by) || by || null,
    bookmarks: pkgMarks(rec),
    transcriptStatus: status, // done | in-progress | none
    transcriptProgress: status === "in-progress" ? Math.round(trPct) : status === "done" ? 100 : null,
    transcript: segs ? { model: segs.model || null, lang: segs.lang || null, at: segs.at || null, segments: segs.segments } : null,
    exportedAt: new Date().toISOString(),
  };
}

function pkgTranscriptText(rec, segments, trPct) {
  const head = `${rec.name}\nRecorded ${new Date(rec.startedAt).toLocaleString()} · ${pkgClock(rec.durationMs || 0)}\n\n`;
  if (!segments) return head + `Transcript in progress (${Math.round(trPct)}% done). This file is replaced when it's finished.\n`;
  return head + segments.map((x) => `[${pkgClock(x.s * 1000)}] ${x.t}`).join("\n") + "\n";
}

// Upload the small files next to the video. where = { folderId } (newer script) or { folder } (older one).
// While a transcript is being made (trPct set) the .txt says so, and is replaced once it's done.
async function driveUploadSidecars(conn, rec, videoName, transcript, where, replace, trPct = null) {
  const base = pkgBase(videoName);
  const status = pkgTrStatus(transcript, trPct);
  const files = [[base + PKG_SUFFIX, "application/json", JSON.stringify(pkgMeta(rec, videoName, transcript, conn.email, trPct), null, 2)]];
  if (status !== "none")
    files.push([`${base} transcript.txt`, "text/plain", pkgTranscriptText(rec, status === "done" ? transcript.segments : null, trPct)]);
  for (const [name, mime, text] of files) {
    const blob = new Blob([text], { type: mime });
    const { uploadUrl } = await driveScriptCall(conn, { action: "start", name, size: blob.size, mime, replace: !!replace, ...where });
    await driveSendToSession(uploadUrl, blob);
  }
}

// Video first (with progress), then the transcript + notes (transcript / trPct may be functions). A newer script puts all of it in its own
// folder; an older one ignores "path" and puts everything in <folder> like before.
// Returns { fileUrl, folderUrl, folderId, packaged, sidecarError }.
async function driveUploadPackage(conn, blob, rec, videoName, folderName, transcript, onProgress, trPct = null) {
  const first = await driveScriptCall(conn, {
    action: "start",
    name: videoName,
    folder: folderName,
    path: [folderName, pkgBase(videoName)],
    size: blob.size,
    mime: blob.type || "video/webm",
  });
  const file = await driveSendToSession(first.uploadUrl, blob, onProgress);
  const packaged = first.v >= 2 && !!first.folderId;
  const out = {
    fileUrl: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
    folderUrl: first.folderUrl,
    folderId: packaged ? first.folderId : null,
    packaged,
    sidecarError: null,
  };
  try {
    // Read the transcript state now, after the (long) video upload: it may have moved on meanwhile
    const tr = typeof transcript === "function" ? await transcript() : transcript;
    const pct = typeof trPct === "function" ? await trPct() : trPct;
    await driveUploadSidecars(conn, rec, videoName, tr, packaged ? { folderId: first.folderId } : { folder: folderName }, false, pct);
  } catch (e) {
    out.sidecarError = e.message; // the video itself is on Drive; the extras can be sent again later
  }
  return out;
}

// How far a background transcript of this recording has got (0-100), or null when none is queued.
// Reads what background.js keeps in storage: trQueue [{id}], trState {id, pct}.
async function trPctFor(id) {
  const { trQueue = [], trState } = await chrome.storage.local.get(["trQueue", "trState"]);
  if (!trQueue.some((x) => x.id === id)) return null;
  return trState && trState.id === id ? Math.round(trState.pct || 0) : 0;
}

// Send an uploaded recording's info file + transcript to its Drive folder again, from what is stored now.
// Used by the background worker (transcript progress / done) and, through it, by the library.
// Returns { ok } | { skipped: why } | { error }.
async function driveSyncPackage(id) {
  const { recordings = [], driveConn: conn } = await chrome.storage.local.get(["recordings", "driveConn"]);
  const rec = recordings.find((r) => r.startedAt === id);
  if (!rec || !rec.uploaded) return { skipped: "This recording isn't on your Drive yet" };
  const folderId = rec.driveFolderId || ((rec.folderUrl || "").match(/\/folders\/([^/?#]+)/) || [])[1];
  if (!folderId) return { skipped: "The Drive folder of this recording is unknown" };
  if (!conn || !conn.url) return { skipped: "Google Drive is not connected" };
  try {
    const { v } = await driveScriptCall(conn, { action: "ping" });
    if (!(v >= 2)) throw new Error(DRIVE_OLD_SCRIPT);
    let videoName = rec.driveName;
    if (!videoName && rec.downloadId) {
      const [item] = await chrome.downloads.search({ id: rec.downloadId });
      if (item && item.filename) videoName = item.filename.split(/[\\/]/).pop();
    }
    if (!videoName) videoName = `${rec.name}.${rec.ext === "mp4" ? "mp4" : "webm"}`;
    const key = "tr-" + id;
    const transcript = (await chrome.storage.local.get(key))[key] || null;
    await driveUploadSidecars(conn, rec, videoName, transcript, { folderId }, true, await trPctFor(id));
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
}

// ---------- Import from a Drive link (through the recipient's own connected script) ----------
// Folder or file link, or a bare id
function driveLinkId(link) {
  const s = String(link || "").trim();
  const m = s.match(/\/folders\/([\w-]{10,})/) || s.match(/\/file\/d\/([\w-]{10,})/) || s.match(/[?&]id=([\w-]{10,})/);
  if (m) return m[1];
  return /^[\w-]{10,}$/.test(s) ? s : null;
}

// { name, packages: [{ meta: <info file text>, videos: [{ id, name, size }] }], token }
async function driveReadShared(conn, link) {
  const id = driveLinkId(link);
  if (!id) throw new Error("That doesn't look like a Google Drive folder link");
  try {
    return await driveScriptCall(conn, { action: "readFolder", id });
  } catch (e) {
    if (/Unknown action/i.test(e.message)) throw new Error(DRIVE_OLD_SCRIPT);
    if (/not found|no item|access denied|permission/i.test(e.message) && !/UrlFetchApp|external_request/i.test(e.message))
      throw new Error(`Your Drive (${conn.email || "connected account"}) can't open that folder. Ask the sender to share it with this account, or to set it to Anyone with the link.`);
    throw e;
  }
}

// A Drive file as a stream, downloaded in 16 MB pieces (retries a piece, renews the key when it expires)
function driveFileStream(conn, fileId, size, token) {
  const PIECE = 16 * 1024 * 1024;
  let offset = 0;
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
  return new ReadableStream({
    async pull(ctl) {
      if (size && offset >= size) return ctl.close();
      const end = size ? Math.min(offset + PIECE, size) - 1 : offset + PIECE - 1;
      let res;
      for (let attempt = 0; ; attempt++) {
        try {
          res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Range: `bytes=${offset}-${end}` } });
          if (res.status === 401 && attempt < 5) token = (await driveScriptCall(conn, { action: "token" })).token;
          else if (res.status < 500 || attempt >= 5) break;
        } catch (e) {
          if (attempt >= 5) throw e;
        }
        await new Promise((r) => setTimeout(r, 1000 * 2 ** Math.min(attempt, 4)));
      }
      if (res.status === 416) return ctl.close(); // past the end
      if (!res.ok) throw new Error(`Drive download failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      offset += buf.byteLength;
      if (buf.byteLength) ctl.enqueue(buf);
      // No size known, or Drive sent the whole file at once: stop when a piece comes back short
      if (res.status === 200 || (!size && buf.byteLength < PIECE)) ctl.close();
    },
  });
}

// Whole flow: today's folder -> upload -> make public. Returns { fileUrl, folderUrl, shared }.
async function driveUploadToDayFolder(token, blob, name, dateName, onProgress) {
  const folderId = await driveDayFolder(token, dateName);
  const file = await driveUploadFile(token, blob, name, folderId, onProgress);
  let shared = true;
  try {
    await driveMakePublic(token, folderId);
  } catch (e) {
    shared = false; // e.g. a Workspace admin blocks public links; the upload itself still succeeded
    console.warn("Could not make the folder public:", e);
  }
  return {
    fileUrl: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
    folderUrl: `https://drive.google.com/drive/folders/${folderId}`,
    shared,
  };
}
