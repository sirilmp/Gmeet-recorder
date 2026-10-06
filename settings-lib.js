// Settings shared by the settings page, the library and the background worker.
const SETTINGS_DEFAULTS = {
  showDock: true, // floating Stop / Bookmark bar on the Meet page while recording
  autoUpload: false, // upload to Drive (through the saved script connection) when a recording ends
  deleteUploaded: false, // remove the local file once it is safely on Drive
  deleteAfterDays: 0, // remove local files older than this many days (0 = never)
  autoRecord: "ask", // "ask" = offer to record when I join a meeting, "off" = never
  autoTranscribe: true, // make a transcript of every new recording in the background
  transcriptModel: "onnx-community/whisper-base", // speech model used for transcripts (runs on this PC)
  transcriptLang: "auto", // spoken language, or auto-detect
};

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...SETTINGS_DEFAULTS, ...(settings || {}) };
}

async function saveSettings(patch) {
  await chrome.storage.local.set({ settings: { ...(await getSettings()), ...patch } });
}

// How old a recording is for the "older than N days" rule. Imported recordings count from the import.
const recordingAge = (r) => Date.now() - (r.imported ? r.imported.at : r.startedAt);

// The recordings the rules say to remove from this PC now. A recording whose transcript is still
// being made waits until it is done (the transcript reads the copy kept inside the extension).
async function cleanupCandidates(s) {
  s = s || (await getSettings());
  if (!s.deleteUploaded && !s.deleteAfterDays) return [];
  const { recordings = [], trQueue = [] } = await chrome.storage.local.get(["recordings", "trQueue"]);
  const queued = new Set(trQueue.map((x) => x.id));
  return recordings.filter((r) => {
    if (r.localDeleted || queued.has(r.startedAt)) return false;
    const old = s.deleteAfterDays && recordingAge(r) > s.deleteAfterDays * 864e5;
    return (s.deleteUploaded && r.uploaded) || old;
  });
}

// Deletes local copies that the rules say are no longer needed: the file in Downloads/MeetRecordings
// and the copy kept inside the extension. Nothing on Google Drive is touched, and the library entry
// stays (marked "Removed from this PC") with its Drive link, transcript and bookmarks.
// Returns how many recordings were removed.
async function runCleanup() {
  const doomed = await cleanupCandidates();
  if (!doomed.length) return 0;
  let root = null;
  try {
    root = await navigator.storage.getDirectory();
  } catch {}
  for (const r of doomed) {
    if (r.downloadId != null) {
      const found = await new Promise((res) => chrome.downloads.search({ id: r.downloadId }, res));
      if (found[0] && found[0].exists) await new Promise((res) => chrome.downloads.removeFile(r.downloadId, () => res(chrome.runtime.lastError)));
    }
    if (root) {
      const ext = r.ext === "mp4" ? "mp4" : "webm";
      for (const name of [`keep-${r.startedAt}.${ext}`, `trsrc-${r.startedAt}.${ext}`]) await root.removeEntry(name).catch(() => {});
    }
  }
  // Read the list again so a change made meanwhile (a new recording, an upload) is not lost
  const ids = new Set(doomed.map((r) => r.startedAt));
  const { recordings = [] } = await chrome.storage.local.get("recordings");
  for (const r of recordings) if (ids.has(r.startedAt)) r.localDeleted = true;
  await chrome.storage.local.set({ recordings });
  return doomed.length;
}
