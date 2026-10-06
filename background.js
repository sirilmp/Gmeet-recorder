const OFFSCREEN_URL = "offscreen.html";
const FOLDER = "MeetRecordings"; // inside the browser's Downloads folder

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  if (existing.length) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    // No AUDIO_PLAYBACK: Chrome closes such documents after ~30s of silence, which would kill the recording
    reasons: ["USER_MEDIA"],
    justification: "Record the Meet tab and microphone with MediaRecorder",
  });
}

function tellTab(tabId, msg) {
  return chrome.tabs.sendMessage(tabId, { target: "tab", msg }).catch(() => {});
}

// Right-click menu: only "Start" while idle, only "Stop" and "Bookmark" while recording
function syncMenu(recording) {
  const set = (id, visible) => chrome.contextMenus.update(id, { visible }, () => void chrome.runtime.lastError);
  set("mr-start", !recording);
  set("mr-stop", !!recording);
  set("mr-mark", !!recording);
}

async function setState(recording, startedAt = null) {
  await chrome.storage.session.set({ recording, startedAt });
  syncMenu(recording);
  if (!recording) {
    const { recTabId } = await chrome.storage.session.get("recTabId");
    if (recTabId != null) {
      await tellTab(recTabId, { kind: "rec-stop" });
      await chrome.storage.session.remove(["recTabId", "recMeetUrl"]);
    }
  }
  await chrome.action.setBadgeText({ text: recording ? "REC" : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
}

function safeName(name) {
  const cleaned = String(name || "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "Meeting";
}

function stamp(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`;
}

// The screen picker must be opened from an extension window (not the popup, which closes, and not
// the service worker). picker.html opens it and reports the chosen stream id back here.
function pickScreen() {
  return new Promise((resolve) => {
    let winId = null;
    const done = (id) => {
      chrome.runtime.onMessage.removeListener(onMsg);
      chrome.windows.onRemoved.removeListener(onRemoved);
      resolve(id);
    };
    const onMsg = (m) => {
      if (m.target === "background" && m.type === "picked") done(m.id ? { id: m.id, audio: !!m.audio } : null);
    };
    const onRemoved = (id) => {
      if (id === winId) done(null);
    };
    chrome.runtime.onMessage.addListener(onMsg);
    chrome.windows.onRemoved.addListener(onRemoved);
    chrome.windows
      .create({ url: chrome.runtime.getURL("picker.html"), type: "popup", width: 460, height: 280, focused: true })
      .then((w) => (winId = w.id))
      .catch(() => done(null));
  });
}

function getToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: !!interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error((chrome.runtime.lastError && chrome.runtime.lastError.message) || "Google sign-in failed"));
      } else resolve(token);
    });
  });
}

async function markUploaded({ startedAt, fileUrl, folderUrl }) {
  const { recordings = [] } = await chrome.storage.local.get("recordings");
  const r = recordings.find((x) => x.startedAt === startedAt);
  if (r) {
    Object.assign(r, { uploaded: true, driveUrl: fileUrl, folderUrl });
    await chrome.storage.local.set({ recordings });
  }
}

async function start(tabId, useMic, name, mode, autoUpload, micId, presentScreen, quality) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !tab.url.startsWith("https://meet.google.com/")) {
    throw new Error("Open a Google Meet tab first.");
  }
  const { recording } = await chrome.storage.session.get("recording");
  if (recording) throw new Error("Already recording.");

  // Screen mode: user picks a screen/window; participants' voices still come from the tab audio
  let desktopStreamId = null;
  let desktopAudio = false;
  if (mode === "screen") {
    const picked = await pickScreen();
    if (!picked) throw new Error("Screen selection cancelled.");
    desktopStreamId = picked.id;
    desktopAudio = picked.audio;
  }

  // Tab mode: also grab the whole screen, used only while I'm presenting
  let presentStreamId = null;
  if (mode !== "screen" && presentScreen) {
    const picked = await pickScreen();
    if (!picked) throw new Error("Screen selection cancelled. Pick “Entire screen”, or turn off “Record my screen when I present”.");
    presentStreamId = picked.id;
  }

  const startedAt = Date.now();
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  await chrome.storage.session.set({ diag: {} });
  await chrome.storage.session.remove(["upload", "marks"]);
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "start",
    streamId,
    desktopStreamId,
    desktopAudio,
    useMic,
    micId,
    presentStreamId,
    quality,
  });
  if (!res || !res.ok) throw new Error((res && res.error) || "Failed to start recording.");
  await chrome.storage.local.set({
    pending: { name: safeName(name), startedAt, mode: mode === "screen" ? "screen" : "tab", autoUpload: !!autoUpload },
  });
  await setState(true, startedAt);
  // Remember the Meet tab + its meeting URL, so leaving the call stops the recording
  await chrome.storage.session.set({ recTabId: tabId, recMeetUrl: meetingPath(tab.url) });
  // Tab mode: the Meet page also sends my screen share (if I present) to the recorder
  await tellTab(tabId, { kind: mode !== "screen" ? "rec-start" : "watch-leave" });
}

// "meet.google.com/abc-defg-hij" part of a URL (ignores ?query and #hash)
function meetingPath(url) {
  const m = (url || "").match(/^https:\/\/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i);
  return m ? m[1].toLowerCase() : null;
}

// "Meeting name" from the tab (same rule as the popup)
function nameFromTab(tab) {
  let t = (tab.title || "").replace(/^Meet\s*[-–]\s*/i, "").replace(/\s*[-–]\s*Google Meet$/i, "").trim();
  if (!t || /^meet$/i.test(t)) t = meetingPath(tab.url) || "Meeting";
  return t;
}

// Flash a short message on the toolbar badge, then go back to REC
async function flashBadge(text, color = "#1a73e8") {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  setTimeout(async () => {
    const { recording } = await chrome.storage.session.get("recording");
    await chrome.action.setBadgeText({ text: recording ? "REC" : "" });
    await chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
  }, 1800);
}

// A bookmark = the time (ms from the start) the user wanted to remember
async function addBookmark() {
  const { recording, startedAt, marks = [] } = await chrome.storage.session.get(["recording", "startedAt", "marks"]);
  if (!recording || !startedAt) return false;
  marks.push(Date.now() - startedAt);
  await chrome.storage.session.set({ marks });
  flashBadge("★" + marks.length);
  return true;
}

// Start with the choices saved in the popup. Always the tab itself (the screen picker needs the popup).
async function startWithPrefs(tab) {
  const { prefs = {} } = await chrome.storage.local.get("prefs");
  await start(tab.id, prefs.useMic !== false, nameFromTab(tab), "tab", false, prefs.micId || null, false, prefs.quality || "standard");
}

// The floating bar on the Meet page reads the recording state straight from session storage
chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" }).catch(() => {});

// Right-click menu on the Meet page. A menu click counts as "invoking" the extension, so it can start
// a recording (a button drawn on the page cannot).
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    const base = { contexts: ["page", "frame", "video", "selection"], documentUrlPatterns: ["https://meet.google.com/*"] };
    chrome.contextMenus.create({ id: "mr", title: "Meet Recorder", ...base });
    chrome.contextMenus.create({ id: "mr-start", parentId: "mr", title: "● Start recording", ...base });
    chrome.contextMenus.create({ id: "mr-stop", parentId: "mr", title: "■ Stop & save", ...base });
    chrome.contextMenus.create({ id: "mr-mark", parentId: "mr", title: "★ Add bookmark", ...base });
    chrome.storage.session.get("recording").then(({ recording }) => syncMenu(!!recording));
  });
});
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === "mr-start") await startWithPrefs(tab);
    else if (info.menuItemId === "mr-stop") await stop();
    else if (info.menuItemId === "mr-mark") await addBookmark();
  } catch (e) {
    await chrome.storage.session.set({ lastError: e.message });
    flashBadge("ERR", "#d93025");
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  const { recording } = await chrome.storage.session.get("recording");
  try {
    if (command === "add-bookmark") await addBookmark();
    else if (command === "toggle-recording") {
      if (recording) {
        await stop();
        flashBadge("SAVE", "#12a150");
      } else {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) await startWithPrefs(tab);
      }
    }
  } catch (e) {
    await chrome.storage.session.set({ lastError: e.message });
    flashBadge("ERR", "#d93025");
  }
});

// Stop + save by itself (left the call, tab closed or navigated away)
let autoStopping = false; // leaving often fires several signals at once
async function autoStop(why) {
  const { recording } = await chrome.storage.session.get("recording");
  if (!recording || autoStopping) return;
  autoStopping = true;
  setTimeout(() => (autoStopping = false), 15000);
  console.log("Auto-stopping recording:", why);
  try {
    await stop();
  } catch (e) {
    await chrome.storage.session.set({ lastError: e.message });
  }
}

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { recTabId } = await chrome.storage.session.get("recTabId");
  if (tabId === recTabId) autoStop("Meet tab closed");
});

chrome.tabs.onUpdated.addListener(async (tabId, change) => {
  if (!change.url) return;
  const { recTabId, recMeetUrl } = await chrome.storage.session.get(["recTabId", "recMeetUrl"]);
  if (tabId === recTabId && meetingPath(change.url) !== recMeetUrl) autoStop("Meet tab left the meeting page");
});

async function stop() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (!existing.length) {
    await setState(false);
    throw new Error("The recorder was closed by Chrome, so there is nothing to save.");
  }
  await chrome.runtime.sendMessage({ target: "offscreen", type: "stop" });
}

// The offscreen page is about to download the finished recording (it triggers the download itself).
// Remember the meeting details and hand back the file name to use.
async function beginSave({ durationMs, size, ext }) {
  ext = ext === "mp4" ? "mp4" : "webm";
  const { pending } = await chrome.storage.local.get("pending");
  const meta = pending || { name: "Meeting", startedAt: Date.now() - durationMs, mode: "tab" };
  const { marks = [] } = await chrome.storage.session.get("marks");
  const filename = `${meta.name} ${stamp(meta.startedAt)}.${ext}`;
  await chrome.storage.local.set({
    saving: { name: meta.name, mode: meta.mode || "tab", startedAt: meta.startedAt, durationMs, size, filename, ext, bookmarks: marks },
  });
  await chrome.storage.local.remove("pending");
  const { settings, driveConn } = await chrome.storage.local.get(["settings", "driveConn"]);
  return { filename, startedAt: meta.startedAt, autoUpload: !!(settings && settings.autoUpload && driveConn && driveConn.url) };
}

// Put the download into Downloads/MeetRecordings and add it to the recordings list.
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (!item.url.startsWith(`blob:chrome-extension://${chrome.runtime.id}/`)) return;
  (async () => {
    const { saving, recordings = [] } = await chrome.storage.local.get(["saving", "recordings"]);
    if (saving) {
      recordings.push({
        downloadId: item.id,
        name: saving.name,
        mode: saving.mode,
        startedAt: saving.startedAt,
        durationMs: saving.durationMs,
        size: saving.size,
        ext: saving.ext || "webm",
        bookmarks: saving.bookmarks || [],
        uploaded: false,
        driveUrl: null,
      });
      await chrome.storage.local.set({ recordings });
      await chrome.storage.local.remove("saving");
    }
    suggest({
      filename: `${FOLDER}/${saving ? saving.filename : item.filename}`,
      conflictAction: "uniquify",
    });
  })();
  return true; // suggest() is called asynchronously
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== "background") return;
  (async () => {
    try {
      const out = { ok: true };
      if (msg.type === "start") await start(msg.tabId, msg.useMic, msg.name, msg.mode, msg.autoUpload, msg.micId, msg.presentScreen, msg.quality);
      else if (msg.type === "token") out.token = await getToken(msg.interactive);
      else if (msg.type === "upload-status") await chrome.storage.session.set({ upload: msg.patch });
      else if (msg.type === "uploaded") await markUploaded(msg);
      else if (msg.type === "stop") await stop();
      else if (msg.type === "bookmark") out.ok = await addBookmark();
      else if (msg.type === "open-popup") {
        try {
          await chrome.action.openPopup();
        } catch {
          out.ok = false;
        }
      } else if (msg.type === "shortcut") {
        const all = await chrome.commands.getAll();
        const c = all.find((x) => x.name === "toggle-recording");
        out.key = (c && c.shortcut) || "";
      }
      else if (msg.type === "left-meeting") {
        const { recTabId } = await chrome.storage.session.get("recTabId");
        if (_sender.tab && _sender.tab.id === recTabId) await autoStop("left the call");
      }
      else if (msg.type === "relay") await tellTab(msg.tabId, msg.msg); // recorder -> Meet page
      else if (msg.type === "diag") {
        const { diag = {} } = await chrome.storage.session.get("diag");
        await chrome.storage.session.set({ diag: { ...diag, ...msg.patch } });
      }
      else if (msg.type === "saving") {
        try {
          Object.assign(out, await beginSave(msg));
          await chrome.storage.session.remove("lastError");
        } catch (e) {
          await chrome.storage.session.set({ lastError: "Saving failed: " + e.message });
        } finally {
          await setState(false);
        }
      } else if (msg.type === "stopped") {
        if (msg.error) await chrome.storage.session.set({ lastError: "Recorder error: " + msg.error });
        await setState(false);
      } else if (msg.type === "reset") {
        await chrome.offscreen.closeDocument().catch(() => {});
        await setState(false);
      }
      sendResponse(out);
    } catch (e) {
      // The popup may have closed (screen picker took focus), so keep the error for its next open
      if (msg.type === "start") await chrome.storage.session.set({ lastError: e.message });
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true;
});

chrome.runtime.onStartup.addListener(() => setState(false));
chrome.runtime.onInstalled.addListener(() => setState(false));
