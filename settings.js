const $ = (id) => document.getElementById(id);
const fmt = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + " GB" : Math.round(n / 1e6) + " MB");
let msgTimer;
function saved() {
  $("msg").textContent = "✓ Saved";
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => ($("msg").textContent = ""), 1500);
}

async function showUsage() {
  const { recordings = [] } = await chrome.storage.local.get("recordings");
  const live = recordings.filter((r) => !r.localDeleted);
  const total = live.reduce((n, r) => n + (r.size || 0), 0);
  $("total").textContent = fmt(total);
  let extra = "";
  try {
    const { usage } = await navigator.storage.estimate();
    extra = ` · ${fmt(usage || 0)} kept inside the extension for uploads`;
  } catch {}
  $("usage").textContent = `${live.length} file${live.length === 1 ? "" : "s"} in Downloads/MeetRecordings${extra}`;
}

async function init() {
  const s = await getSettings();
  $("showDock").checked = s.showDock;
  $("dockAutoPip").checked = s.dockAutoPip;
  $("hideMeetTranslate").checked = s.hideMeetTranslate;
  $("autoUpload").checked = s.autoUpload;
  $("autoTranscribe").checked = s.autoTranscribe;
  $("deleteUploaded").checked = s.deleteUploaded;
  $("deleteAfterDays").value = String(s.deleteAfterDays);
  $("autoRecord").value = s.autoRecord;
  $("transcriptModel").value = s.transcriptModel;
  $("transcriptLang").value = s.transcriptLang;
  const { prefs = {}, driveConn } = await chrome.storage.local.get(["prefs", "driveConn"]);
  $("quality").value = prefs.quality || "standard";
  if (!(driveConn && driveConn.url))
    $("driveState").innerHTML = 'Drive is not connected yet. <a href="library.html">Connect it in the library</a> first.';
  else $("driveState").textContent = `Uploads go to ${driveConn.email || "your Drive"} → Meet Recordings → date folder.`;
  showUsage();
}

$("dockAutoPip").onchange = async () => {
  await saveSettings({ dockAutoPip: $("dockAutoPip").checked });
  saved();
};
$("showDock").onchange = async () => {
  await saveSettings({ showDock: $("showDock").checked });
  saved();
};
$("hideMeetTranslate").onchange = async () => {
  await saveSettings({ hideMeetTranslate: $("hideMeetTranslate").checked });
  saved();
};
$("autoUpload").onchange = async () => {
  await saveSettings({ autoUpload: $("autoUpload").checked });
  saved();
};
$("autoTranscribe").onchange = async () => {
  await saveSettings({ autoTranscribe: $("autoTranscribe").checked });
  saved();
};
$("deleteUploaded").onchange = async () => {
  await saveSettings({ deleteUploaded: $("deleteUploaded").checked });
  saved();
};
$("deleteAfterDays").onchange = async () => {
  const days = Number($("deleteAfterDays").value);
  const before = await getSettings();
  if (days) {
    const now = await cleanupCandidates({ ...before, deleteUploaded: false, deleteAfterDays: days });
    const notOnDrive = now.filter((r) => !r.uploaded).length;
    const lines = [
      `Recordings older than ${days} days will be deleted from this PC automatically, from now on.`,
      now.length ? `\n${now.length} recording${now.length === 1 ? " is" : "s are"} older than that and will be deleted right away.` : "",
      notOnDrive ? `${notOnDrive} of them ${notOnDrive === 1 ? "is" : "are"} NOT on Google Drive and will be lost for good.` : "",
      "\nNothing on Google Drive is deleted. Continue?",
    ];
    if (!confirm(lines.filter(Boolean).join("\n"))) {
      $("deleteAfterDays").value = String(before.deleteAfterDays);
      return;
    }
  }
  await saveSettings({ deleteAfterDays: days });
  saved();
  if (days) {
    const n = await runCleanup();
    if (n) $("cleanMsg").textContent = `Deleted ${n} recording${n === 1 ? "" : "s"} from this PC.`;
    showUsage();
  }
};
for (const k of ["autoRecord", "transcriptModel", "transcriptLang"])
  $(k).onchange = async () => {
    await saveSettings({ [k]: $(k).value });
    saved();
  };
$("quality").onchange = async () => {
  const { prefs = {} } = await chrome.storage.local.get("prefs");
  await chrome.storage.local.set({ prefs: { ...prefs, quality: $("quality").value } });
  saved();
};
$("clean").onclick = async () => {
  const n = await runCleanup();
  $("cleanMsg").textContent = n ? `Deleted ${n} recording${n === 1 ? "" : "s"} from this PC.` : "Nothing to delete.";
  showUsage();
};
init();
