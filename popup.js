const $ = (id) => document.getElementById(id);
let timer = null;

function setMsg(text, isErr = false) {
  $("msg").textContent = text;
  $("msg").className = isErr ? "err" : "";
}

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  const p = (n) => String(n).padStart(2, "0");
  // Same format as the bar on the Meet page: 4:05, then 1:04:05 past an hour
  return s >= 3600 ? `${Math.floor(s / 3600)}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}` : `${Math.floor(s / 60)}:${p(s % 60)}`;
}

// Only the Meet tab is supported (it also picks up my screen share when I present)
const getMode = () => "tab";

async function renderDiag() {
  const { recording, diag = {} } = await chrome.storage.session.get(["recording", "diag"]);
  $("diag").hidden = !recording;
  if (!recording) return;

  // One compact row per thing: coloured dot, name, short state / live wave on the right
  const rows = [];
  const clean = (t) => String(t || "").replace(/[<>&"]/g, "");
  const row = (state, label, value, extra = "", tip = "", hint = "") =>
    rows.push(
      `<div class="st ${state}"${tip ? ` title="${clean(tip)}"` : ""}><span class="sd"></span><span class="sl">${label}</span>` +
        `<span class="sv">${value}</span>${extra}</div>` + (hint ? `<div class="sh">${hint}</div>` : "")
    );
  // Coarse volume steps, so the HTML (and the running animation) only changes when the level really does
  const meter = (lvl) => {
    const v = lvl || 0;
    const step = v <= 0.01 ? 0 : v < 0.08 ? 1 : v < 0.25 ? 2 : 3;
    return `<span class="wave${step ? ` on lv-${step}` : ""}"><i></i><i></i><i></i><i></i><i></i></span>`;
  };

  if (diag.disk === "full") row("bad", "Disk space", "Full, saved", "", "", "Recording stopped to protect the file. Free some space.");
  else if (diag.disk === "low") row("bad", "Disk space", "Low", "", "", "Under about 1.2 GB left. Free some space.");

  if (diag.qualityAdjusted) row("idle", "Quality", "Lowered automatically", "", "", clean(diag.qualityAdjusted));
  if (diag.engine && diag.engine !== "fallback" && !diag.engine.startsWith("GPU"))
    row("bad", "Video encoder", "CPU (software)", "", "", "No hardware encoder found; heavier on the CPU than usual. Pick a lower quality in Settings if the PC feels sluggish.");
  else if (diag.engine === "fallback")
    row("bad", "Video encoder", "CPU (compatibility mode)", "", "", "Couldn't use the fast recorder; falling back is heavier on the CPU. Pick a lower quality in Settings if the PC feels sluggish.");

  if (diag.audio && diag.audio !== "running") row("bad", "Audio engine", clean(diag.audio));

  const micTip = diag.micName ? clean(diag.micName) + (diag.micAuto ? " (same as Meet)" : "") : "";
  if (diag.mic === "on") {
    if (diag.micMuted) row("idle", "My voice", "Muted in Meet", meter(0), micTip);
    else if (diag.micLevel > 0.01) row("ok", "My voice", "Recording", meter(diag.micLevel), micTip);
    else row("bad", "My voice", "No sound", meter(0), micTip, "Pick the mic you talk into in the list above.");
  } else if (diag.mic === "off") row("idle", "My voice", "Mic is off");
  else if (diag.mic) row("bad", "My voice", "Problem", "", clean(diag.mic));
  else row("idle", "My voice", "Starting…");

  if (diag.tabLevel !== undefined)
    row(diag.tabLevel > 0.01 ? "ok" : "idle", "Other voices", diag.tabLevel > 0.01 ? "Recording" : "Silent", meter(diag.tabLevel));

  const share = diag.share;
  if (share === "live") row("ok", "Screen share", "Recording");
  else if (share === "ended") row("idle", "Screen share", "Ended");
  else if (share === "detected" || share === "connecting") row("idle", "Screen share", "Connecting…");
  else if (share) row("bad", "Screen share", "Problem", "", share);
  else if (diag.presentScreen === "ready" || diag.hook === "ready") row("ok", "Screen share", "Ready", "", "Switches to my screen when I click Present now in Meet");
  else if (diag.mic || diag.tabLevel !== undefined)
    row("bad", "Screen share", "Not ready", "", "", "Refresh the Meet tab (F5) and record again.");
  else row("idle", "Screen share", "Checking…");

  if (diag.shareAudio === "on") row("ok", "Share sound", "Recording");
  else if (diag.shareAudio === "pending") row("idle", "Share sound", "Connecting…");
  else if (diag.shareAudio === "none") row("bad", "Share sound", "None", "", "", "Tick “Share tab audio” when presenting.");

  // Who Meet shows as talking: their name goes on the transcript lines
  if (diag.speaker) row("ok", "Speaking", clean(diag.speaker), "", "Transcript lines get this name");
  else if (diag.speakerTiles === 0) row("idle", "Speaking", "No tiles", "", "Meet's video tiles weren't found, so transcript lines won't have names. You can add them in the player.");
  else if (diag.speakerTiles !== undefined) row("idle", "Speaking", "Nobody", "", "Transcript lines get the name of whoever is speaking");

  // Collapsed header: "All good", or how many things need a look
  const bad = rows.filter((r) => r.startsWith('<div class="st bad"')).length;
  const sum = $("diag-sum");
  sum.textContent = bad ? `${bad} need${bad > 1 ? "" : "s"} attention` : rows.some((r) => r.startsWith('<div class="st ok"')) ? "All good" : "Starting…";
  sum.className = bad ? "bad" : rows.some((r) => r.startsWith('<div class="st ok"')) ? "ok" : "";

  const html = rows.join("");
  if ($("diag-lines").innerHTML !== html) $("diag-lines").innerHTML = html; // don't restart the wave needlessly
}

chrome.storage.onChanged.addListener((_c, area) => {
  if (area === "session") renderDiag();
});

async function refresh() {
  renderDiag();
  const { recording, startedAt } = await chrome.storage.session.get(["recording", "startedAt"]);
  $("start").hidden = !!recording;
  $("stop").hidden = !recording;
  $("mark").hidden = !recording;
  $("name").disabled = !!recording;
  $("useMic").disabled = !!recording;
  $("quality").disabled = !!recording;

  clearInterval(timer);
  $("pill-dot").className = "dot" + (recording ? " live" : "");
  if (recording) {
    const tick = () => ($("pill-text").textContent = fmt(Date.now() - startedAt));
    tick();
    timer = setInterval(tick, 1000);
  } else {
    $("pill-text").textContent = "Ready";
  }
}

async function micGranted() {
  try {
    const p = await navigator.permissions.query({ name: "microphone" });
    return p.state === "granted";
  } catch {
    return false;
  }
}

function meetingName(tab) {
  let t = (tab.title || "").replace(/^Meet\s*[-–]\s*/i, "").replace(/\s*[-–]\s*Google Meet$/i, "").trim();
  if (!t || /^meet$/i.test(t)) {
    const m = (tab.url || "").match(/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i);
    t = m ? m[1] : "Meeting";
  }
  return t;
}

const QUALITIES = [
  { key: "low", text: "Low · 360p · 8 fps · smallest files, least CPU" },
  { key: "light", text: "Medium · 540p · 10 fps · for slower PCs" },
  { key: "standard", text: "Good · 720p · 15 fps · recommended" },
  { key: "high", text: "High · 1080p · 20 fps · sharp, big files, heavy on CPU" },
  { key: "ultra", text: "Ultra · 1440p · 24 fps · needs a strong PC, very big files" },
  { key: "max", text: "4K · 2160p · 30 fps · needs a GPU, huge files (~5 GB/hour)" },
];
function showQuality() {
  const v = $("quality").value;
  $("qDesc").textContent = QUALITIES[v].text;
  // filled part of the track: up to the thumb centre
  $("quality").style.setProperty("--fill", `calc(${(v / 5) * 100}% + ${9 - (v / 5) * 18}px)`);
}

async function init() {
  const { prefs = {} } = await chrome.storage.local.get("prefs");
  if (typeof prefs.useMic === "boolean") $("useMic").checked = prefs.useMic;
  // older versions saved a Light mode switch
  const q = prefs.quality || (prefs.lightMode ? "light" : "standard");
  $("quality").value = Math.max(0, QUALITIES.findIndex((x) => x.key === q));
  showQuality();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) $("name").value = meetingName(tab);

  const granted = await micGranted();
  $("mic-perm").hidden = granted;
  if (granted) await loadMics(prefs.micId);
  else $("micId").hidden = true;
  await refresh();

  const { lastError } = await chrome.storage.session.get("lastError");
  if (lastError) {
    setMsg(lastError, true);
    chrome.storage.session.remove("lastError");
  }

}

function savePrefs() {
  chrome.storage.local.set({
    prefs: {
      mode: getMode(),
      useMic: $("useMic").checked,
      micId: $("micId").value,
      quality: QUALITIES[$("quality").value].key,
    },
  });
}
$("quality").oninput = showQuality;
$("quality").onchange = savePrefs;
$("useMic").onchange = savePrefs;
// Switching the mic also works mid-recording (the recording keeps going)
$("micId").onchange = async () => {
  savePrefs();
  const { recording } = await chrome.storage.session.get("recording");
  if (recording && $("useMic").checked)
    chrome.runtime.sendMessage({ target: "offscreen", type: "set-mic", micId: $("micId").value }).catch(() => {});
};

// List the microphones (names are only visible once mic access was granted)
async function loadMics(selected) {
  const sel = $("micId");
  sel.textContent = "";
  const auto = document.createElement("option");
  auto.value = "auto";
  auto.textContent = "Auto: same mic as Google Meet";
  sel.append(auto);
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
  for (const d of devices) {
    const o = document.createElement("option");
    o.value = d.deviceId;
    o.textContent = d.label || "Microphone";
    sel.append(o);
  }
  sel.hidden = !devices.length;
  sel.value = selected && devices.some((d) => d.deviceId === selected) ? selected : "auto";
}
async function renderUpload() {
  const { upload } = await chrome.storage.session.get("upload");
  const box = $("upload-status");
  box.hidden = !upload;
  if (!upload) return;
  if (upload.state === "uploading") box.textContent = `Uploading to Google Drive… ${upload.pct || 0}%`;
  else if (upload.state === "done") {
    box.innerHTML = `<span style="color:var(--success);font-weight:600">✓ Uploaded.</span> <a href="#" id="open-drive">Open day folder</a>` +
      (upload.shared ? "" : `<br>Could not make it public (your account may block public links).`);
    $("open-drive").onclick = (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: upload.folderUrl });
    };
  } else box.innerHTML = `<span style="color:var(--danger);font-weight:600">⚠ Upload failed:</span> ${upload.error}`;
}
chrome.storage.onChanged.addListener((_c, area) => {
  if (area === "session") renderUpload();
});
renderUpload();

$("mic-perm").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("mic.html") });
$("library").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("library.html") });

$("start").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $("start").disabled = true;
  setMsg("Starting…");
  const res = await chrome.runtime.sendMessage({
    target: "background",
    type: "start",
    tabId: tab.id,
    useMic: $("useMic").checked,
    name: $("name").value,
    mode: getMode(),
    micId: $("micId").value || null,
    presentScreen: false,
    quality: QUALITIES[$("quality").value].key,
  });
  $("start").disabled = false;
  if (!res.ok) {
    setMsg(res.error, true);
    return;
  }
  setMsg("");
  await refresh();
};

$("mark").onclick = async () => {
  const res = await chrome.runtime.sendMessage({ target: "background", type: "bookmark" });
  const s = $("mark").querySelector("span");
  s.textContent = res && res.ok ? "Added" : "Not recording";
  setTimeout(() => (s.textContent = "Bookmark"), 1500);
};

$("stop").onclick = async () => {
  $("stop").disabled = true;
  setMsg("Saving…");
  const res = await chrome.runtime.sendMessage({ target: "background", type: "stop" });
  if (!res.ok) {
    $("stop").disabled = false;
    await refresh();
    setMsg(res.error, true);
    return;
  }
  // Wait until the background script has finished saving (up to 30 s)
  let done = false;
  for (let i = 0; i < 60 && !done; i++) {
    const { recording } = await chrome.storage.session.get("recording");
    if (!recording) done = true;
    else await new Promise((r) => setTimeout(r, 500));
  }
  if (!done) {
    // Recorder never reported back: reset so the popup isn't stuck in "recording"
    await chrome.runtime.sendMessage({ target: "background", type: "reset" });
    $("stop").disabled = false;
    await refresh();
    setMsg("Saving timed out and the recorder was reset. Reload the extension and try again.", true);
    return;
  }
  $("stop").disabled = false;
  await refresh();
  const { lastError } = await chrome.storage.session.get("lastError");
  if (lastError) setMsg(lastError, true);
  else setMsg("Saved to Downloads/MeetRecordings");
};

init();
