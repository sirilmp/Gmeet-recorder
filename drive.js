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
      out = { ok: true, email: Session.getEffectiveUser().getEmail() };
    }
    else if (req.action === "start") out = startUpload(req);
    else if (req.action === "share") out = shareFile(req);
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

// Who can open the file: private | domain (my organization) | anyone (with the link)
function shareFile(req) {
  const A = DriveApp.Access;
  const access = { private: A.PRIVATE, domain: A.DOMAIN_WITH_LINK, anyone: A.ANYONE_WITH_LINK }[req.access];
  if (!access) throw new Error("Unknown access");
  DriveApp.getFileById(req.fileId).setSharing(access, DriveApp.Permission.VIEW);
  return { ok: true };
}

function folder(name, parent) {
  const found = parent.getFoldersByName(name);
  return found.hasNext() ? found.next() : parent.createFolder(name);
}

function startUpload(req) {
  let dir = folder(ROOT, DriveApp.getRootFolder());
  if (req.folder) dir = folder(req.folder, dir);
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
  return { ok: true, uploadUrl: uploadUrl, folderUrl: dir.getUrl() };
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
    const doc = new DOMParser().parseFromString(text, "text/html");
    const said = ((doc.title || "") + " " + (doc.body ? doc.body.innerText : ""))
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

// Change who can open an uploaded file (needs the newer script that has the "share" action)
async function driveShare(conn, fileId, access) {
  try {
    await driveScriptCall(conn, { action: "share", fileId, access });
  } catch (e) {
    if (/Unknown action/i.test(e.message))
      throw new Error(
        "Your Drive script is older. Open Connect Google Drive, copy the code again, paste it over the old one in the script editor, save, then Deploy → Manage deployments → ✏️ → New version → Deploy."
      );
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
