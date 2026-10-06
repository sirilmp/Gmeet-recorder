importScripts("settings-lib.js", "drive.js", "speakers-lib.js");

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
    reasons: ["USER_MEDIA", "WORKERS"],
    justification: "Record the Meet tab and microphone, and make transcripts of finished recordings",
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
  await chrome.action.setBadgeBackgroundColor({ color: "#e5484d" });
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

async function markUploaded({ startedAt, fileUrl, folderUrl, folderId, packaged, driveName }) {
  const { recordings = [] } = await chrome.storage.local.get("recordings");
  const r = recordings.find((x) => x.startedAt === startedAt);
  if (r) {
    Object.assign(r, { uploaded: true, driveUrl: fileUrl, folderUrl, driveFolderId: folderId || null, packaged: !!packaged, driveName });
    await chrome.storage.local.set({ recordings });
    if (packaged) driveSync(startedAt); // the transcript is usually still being made: say how far it is
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
  await chrome.storage.session.remove(["upload", "marks", "spk"]);
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
    await chrome.action.setBadgeBackgroundColor({ color: "#e5484d" });
  }, 1800);
}

// A bookmark = the time (ms from the start) the user wanted to remember
async function addBookmark() {
  const { recording, startedAt, marks = [] } = await chrome.storage.session.get(["recording", "startedAt", "marks"]);
  if (!recording || !startedAt) return false;
  const at = Date.now() - startedAt;
  // The Meet page also catches Alt+Shift+B (for when Chrome didn't assign the shortcut), so one
  // keypress can arrive twice: keep only one
  if (marks.length && at - marks[marks.length - 1] < 1500) return true;
  marks.push(at);
  await chrome.storage.session.set({ marks });
  flashBadge("★" + marks.length);
  return true;
}

// Who is speaking, as the Meet page sees it (content.js): [ms from the start, name or null] each time
// it changes. Kept next to the bookmarks and saved with the recording; the transcript lines take
// their speaker names from it. One write at a time so quick changes don't overwrite each other.
let spkChain = Promise.resolve();
function addSpeaker(name, lag, tabId) {
  spkChain = spkChain
    .then(async () => {
      const { recording, startedAt, recTabId, spk = [] } = await chrome.storage.session.get(["recording", "startedAt", "recTabId", "spk"]);
      if (!recording || !startedAt || tabId !== recTabId) return;
      name = typeof name === "string" && name.trim() ? name.trim().slice(0, 60) : null;
      const at = Math.max(0, Date.now() - startedAt - Math.max(0, Math.min(5000, +lag || 0)));
      const last = spk[spk.length - 1];
      if (last && last[1] === name) return;
      if (last && at <= last[0]) spk[spk.length - 1] = [last[0], name];
      else spk.push([at, name]);
      const { diag = {} } = await chrome.storage.session.get("diag");
      await chrome.storage.session.set({ spk, diag: { ...diag, speaker: name || "" } });
    })
    .catch(() => {});
  return spkChain;
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
    if (command === "add-bookmark") {
      // Not recording: the shortcut bookmarks the open player in the library instead
      if (!(await addBookmark())) chrome.runtime.sendMessage({ target: "library", type: "bookmark" }).catch(() => {});
    }
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
  const { marks = [], spk = [] } = await chrome.storage.session.get(["marks", "spk"]);
  const filename = `${meta.name} ${stamp(meta.startedAt)}.${ext}`;
  const saving = { name: meta.name, mode: meta.mode || "tab", startedAt: meta.startedAt, durationMs, size, filename, ext, bookmarks: marks };
  if (spk.some((x) => x[1])) saving.speakers = spk;
  await chrome.storage.local.set({ saving });
  await chrome.storage.local.remove("pending");
  const { settings, driveConn } = await chrome.storage.local.get(["settings", "driveConn"]);
  return {
    filename,
    startedAt: meta.startedAt,
    rec: saving, // what the Drive upload writes into the recording's info file
    autoUpload: !!(settings && settings.autoUpload && driveConn && driveConn.url),
  };
}

// Put the download into Downloads/MeetRecordings and add it to the recordings list.
// Files this worker saves itself (transcripts): url -> path. Chrome ignores the filename given to
// downloads.download() once an extension listens to onDeterminingFilename, so it is suggested here.
const namedDownloads = new Map();

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  const named = namedDownloads.get(item.url);
  if (named) {
    namedDownloads.delete(item.url);
    suggest({ filename: named, conflictAction: "overwrite" });
    return;
  }
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
        ...(saving.speakers ? { speakers: saving.speakers } : {}),
        uploaded: false,
        driveUrl: null,
        ...(saving.imported ? { imported: saving.imported } : {}),
      });
      await chrome.storage.local.set({ recordings });
      await chrome.storage.local.remove("saving");
      // Not for an imported recording that came with its transcript, or whose sender is still making one
      const trK = "tr-" + saving.startedAt;
      const hasTr = !!(await chrome.storage.local.get(trK))[trK];
      const senderBusy = saving.imported && saving.imported.trStatus === "in-progress";
      if ((await getSettings()).autoTranscribe && !hasTr && !senderBusy) trAdd(saving.startedAt, saving.ext).catch(() => {});
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
      else if (msg.type === "drive-sync") Object.assign(out, await driveSync(msg.id));
      else if (msg.type === "stop") await stop();
      else if (msg.type === "bookmark") out.ok = await addBookmark();
      else if (msg.type === "speaker") await addSpeaker(msg.name, msg.lag, _sender.tab && _sender.tab.id);
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
        await trKick(); // a transcript that was running goes on from its last saved slice
      } else if (msg.type.startsWith("tr-")) Object.assign(out, await onTranscriptMsg(msg));
      sendResponse(out);
    } catch (e) {
      // The popup may have closed (screen picker took focus), so keep the error for its next open
      if (msg.type === "start") await chrome.storage.session.set({ lastError: e.message });
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true;
});

// ---------- transcripts, made in the background ----------
// The offscreen page does the work (transcriber.js); this worker owns the bookkeeping, since that page
// can't use chrome.storage. In chrome.storage.local:
//   trQueue: [{id, ext}]   recordings waiting for a transcript, the first one is being worked on
//   trp-<id>: {model, lang, doneSec, segments} progress so far, or {error} if it failed
//   trState: {id, phase, pct, text}   what the running job is doing, for the library
//   tr-<id>: {model, lang, at, segments}   the finished transcript (read by the library)
// (id = the recording's startedAt)
const trpKey = (id) => "trp-" + id;

async function trKick() {
  const { recording } = await chrome.storage.session.get("recording");
  if (recording) return; // resumes when the recording is saved
  const { trQueue = [] } = await chrome.storage.local.get("trQueue");
  if (!trQueue.length) return;
  await ensureOffscreen();
  await chrome.runtime.sendMessage({ target: "offscreen", type: "tr-kick" }).catch(() => {});
}

// front: the user asked for it in the player, so it goes right after the one running now
async function trAdd(id, ext, front = false) {
  const { trQueue = [] } = await chrome.storage.local.get("trQueue");
  if (!trQueue.some((x) => x.id === id)) {
    trQueue.splice(front ? Math.min(1, trQueue.length) : trQueue.length, 0, { id, ext: ext === "mp4" ? "mp4" : "webm" });
    await chrome.storage.local.remove(trpKey(id)); // a fresh start (also clears an old error)
    await chrome.storage.local.set({ trQueue });
  }
  await trKick();
}

async function trRemove(id) {
  const { trQueue = [], trState } = await chrome.storage.local.get(["trQueue", "trState"]);
  await chrome.storage.local.set({ trQueue: trQueue.filter((x) => x.id !== id) });
  if (trState && trState.id === id) await chrome.storage.local.remove("trState");
}

// true while id is still the job at the head of the queue (a cancel may have dropped it)
async function trIsCurrent(id) {
  const { trQueue = [] } = await chrome.storage.local.get("trQueue");
  return !!trQueue.length && trQueue[0].id === id;
}

async function trNext() {
  const { recording } = await chrome.storage.session.get("recording");
  if (recording) return null;
  for (;;) {
    const { trQueue = [], recordings = [] } = await chrome.storage.local.get(["trQueue", "recordings"]);
    if (!trQueue.length) {
      await chrome.storage.local.remove("trState");
      return null;
    }
    const job = trQueue[0];
    const rec = recordings.find((r) => r.startedAt === job.id);
    if (!rec) {
      await trRemove(job.id); // deleted from the library meanwhile
      continue;
    }
    let p = (await chrome.storage.local.get(trpKey(job.id)))[trpKey(job.id)];
    if (!p || p.error) {
      const s = await getSettings();
      p = { model: s.transcriptModel, lang: s.transcriptLang, doneSec: 0, segments: [] };
      await chrome.storage.local.set({ [trpKey(job.id)]: p });
    }
    const durationSec = (rec.durationMs || 0) / 1000;
    const pct = durationSec ? Math.min(99, Math.round((p.doneSec / durationSec) * 100)) : 0;
    await chrome.storage.local.set({ trState: { id: job.id, phase: "reading", pct, text: "Reading the audio…" } });
    return { id: job.id, ext: job.ext, durationSec, model: p.model, lang: p.lang, doneSec: p.doneSec, segments: p.segments };
  }
}

async function onTranscriptMsg(msg) {
  const id = msg.id;
  if (msg.type === "tr-add") await trAdd(id, msg.ext, !!msg.front);
  else if (msg.type === "tr-kick") await trKick();
  else if (msg.type === "tr-cancel") {
    const { trState } = await chrome.storage.local.get("trState");
    await trRemove(id);
    await chrome.storage.local.remove(trpKey(id));
    if (trState && trState.id === id) await chrome.runtime.sendMessage({ target: "offscreen", type: "tr-abort", id }).catch(() => {});
  } else if (msg.type === "tr-next") return { ...(await trNext()) };
  else if (msg.type === "tr-files") {
    // speaker names changed in the player: rewrite the .txt / .vtt next to the video
    const tr = (await chrome.storage.local.get("tr-" + id))["tr-" + id];
    if (tr) await saveTranscriptFiles(id, tr.segments).catch((e) => console.warn("transcript files not saved", e));
    return {};
  }
  else if (!(await trIsCurrent(id))) return {}; // late report for a job that was cancelled
  else if (msg.type === "tr-state") await chrome.storage.local.set({ trState: { id, phase: msg.phase, pct: msg.pct, text: msg.text } });
  else if (msg.type === "tr-progress") {
    const p = (await chrome.storage.local.get(trpKey(id)))[trpKey(id)] || {};
    await chrome.storage.local.set({
      [trpKey(id)]: { ...p, doneSec: msg.doneSec, segments: msg.segments },
      trState: { id, phase: "transcribing", pct: msg.pct, text: `Transcribing… ${msg.pct}%` },
    });
  } else if (msg.type === "tr-done") {
    const p = (await chrome.storage.local.get(trpKey(id)))[trpKey(id)] || {};
    const { recordings = [] } = await chrome.storage.local.get("recordings");
    const rec = recordings.find((r) => r.startedAt === id);
    msg.segments = labelSpeakers(msg.segments, rec && rec.speakers);
    await chrome.storage.local.set({ ["tr-" + id]: { model: p.model, lang: p.lang, at: Date.now(), segments: msg.segments } });
    await chrome.storage.local.remove(trpKey(id));
    await trRemove(id);
    await saveTranscriptFiles(id, msg.segments).catch((e) => console.warn("transcript files not saved", e));
  } else if (msg.type === "tr-failed") {
    await chrome.storage.local.set({ [trpKey(id)]: { error: msg.error, at: Date.now() } });
    await trRemove(id);
  }
  driveOnTranscript(msg);
  return {};
}

// ---------- keeping an uploaded recording's Drive folder up to date ----------
// The transcript is made here in the background, often after the upload: Drive hears when it starts,
// every 25%, and when it's finished (or cancelled). One sync at a time, so an older "in progress"
// can never land after the finished transcript.
let driveChain = Promise.resolve();
const driveSteps = new Map(); // id -> last 25% step sent
function driveSync(id) {
  const run = driveChain.then(() => driveSyncPackage(id));
  driveChain = run.catch(() => {});
  return run.then((out) => {
    if (out.error) console.warn("Drive transcript/notes update failed:", out.error);
    return out;
  });
}
function driveOnTranscript(msg) {
  const id = msg.id;
  if (msg.type === "tr-add" || msg.type === "tr-done" || msg.type === "tr-cancel" || msg.type === "tr-failed") {
    driveSteps.delete(id);
    if (msg.type === "tr-add") driveSteps.set(id, 0);
    driveSync(id);
  } else if (msg.type === "tr-progress") {
    const step = Math.floor((msg.pct || 0) / 25) * 25;
    if ((driveSteps.get(id) ?? -1) < step) {
      driveSteps.set(id, step);
      driveSync(id);
    }
  }
}

// A copy of the transcript next to the video in Downloads/MeetRecordings, so it outlives the extension:
// "<video name>.txt" to read, "<video name>.vtt" that video players pick up as subtitles.
async function saveTranscriptFiles(id, segments) {
  if (!segments || !segments.length) return;
  const { recordings = [] } = await chrome.storage.local.get("recordings");
  const rec = recordings.find((r) => r.startedAt === id);
  if (!rec) return;
  const [item] = await chrome.downloads.search({ id: rec.downloadId });
  const video = item && item.filename ? item.filename.split(/[\\/]/).pop() : `${safeName(rec.name)} ${stamp(rec.startedAt)}.${rec.ext || "webm"}`;
  const base = `${FOLDER}/${video.replace(/\.[^.]+$/, "")}`;
  const p = (n, w = 2) => String(n).padStart(w, "0");
  const clock = (s) => {
    const ms = Math.round(s * 1000);
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}`;
  };
  const vttTime = (s) => `${clock(s)}.${p(Math.round(s * 1000) % 1000, 3)}`;
  const txt = segments.map((x) => `[${clock(x.s)}] ${speakerText(x)}`).join("\n") + "\n";
  const vtt = "WEBVTT\n\n" + segments.map((x, i) => `${i + 1}\n${vttTime(x.s)} --> ${vttTime(Math.max(x.e, x.s))}\n${vttVoice(x)}\n`).join("\n");
  // the service worker can't make blob: URLs, a data: URL is fine at transcript sizes
  const save = async (body, ext, type) => {
    const url = `data:${type};charset=utf-8,` + encodeURIComponent(body);
    namedDownloads.set(url, `${base}.${ext}`);
    try {
      // "overwrite": a Redo replaces the old files
      await chrome.downloads.download({ url, filename: `${base}.${ext}`, conflictAction: "overwrite", saveAs: false });
    } finally {
      setTimeout(() => namedDownloads.delete(url), 60_000);
    }
  };
  await save(txt, "txt", "text/plain");
  await save(vtt, "vtt", "text/vtt");
}

chrome.runtime.onStartup.addListener(async () => {
  await setState(false);
  await chrome.storage.local.remove("trState");
  await trKick(); // finish transcripts the browser closed on
});
chrome.runtime.onInstalled.addListener(async () => {
  await setState(false);
  await trKick();
});
