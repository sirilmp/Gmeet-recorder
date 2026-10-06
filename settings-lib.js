// Settings shared by the settings page, the library and the background worker.
const SETTINGS_DEFAULTS = {
  showDock: true, // floating Record / Stop / Bookmark bar on the Meet page
  autoUpload: false, // upload to Drive (through the saved script connection) when a recording ends
  deleteUploaded: false, // remove the local file once it is safely on Drive
  deleteAfterDays: 0, // remove local files older than this many days (0 = never)
  autoRecord: "ask", // "ask" = offer to record when I join a meeting, "off" = never
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

// Deletes local files (in Downloads) that the rules say are no longer needed. The entry stays in
// the list (marked "local file deleted") so its Drive link is kept. Returns how many files were removed.
async function runCleanup() {
  const s = await getSettings();
  if (!s.deleteUploaded && !s.deleteAfterDays) return 0;
  const { recordings = [] } = await chrome.storage.local.get("recordings");
  let removed = 0;
  let changed = false;
  for (const r of recordings) {
    if (r.localDeleted) continue;
    const old = s.deleteAfterDays && Date.now() - r.startedAt > s.deleteAfterDays * 864e5;
    if (!((s.deleteUploaded && r.uploaded) || old)) continue;
    const found = await new Promise((res) => chrome.downloads.search({ id: r.downloadId }, res));
    if (found[0] && found[0].exists) {
      await new Promise((res) => chrome.downloads.removeFile(r.downloadId, res));
      removed++;
    }
    r.localDeleted = true;
    changed = true;
  }
  if (changed) await chrome.storage.local.set({ recordings });
  return removed;
}
