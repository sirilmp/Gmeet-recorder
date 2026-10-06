// A small floating control bar on the Meet page: Record / Stop / Bookmark. Drag it anywhere.
// Drawn in a shadow root so Meet's styles can't touch it (and it can't touch Meet's).
(() => {
  if (window.top !== window) return;
  if (document.getElementById("meet-recorder-dock")) return;

  const host = document.createElement("div");
  host.id = "meet-recorder-dock";
  host.style.cssText = "position:fixed;z-index:2147483646;left:0;top:0;";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .bar { display: flex; align-items: center; gap: 4px; padding: 5px; border-radius: 999px;
        background: rgba(24,27,52,.94); color: #fff; font: 600 13px/1 "Segoe UI", system-ui, sans-serif;
        box-shadow: 0 6px 24px rgba(0,0,0,.35); user-select: none; backdrop-filter: blur(6px); }
      .grip { width: 22px; height: 30px; display: grid; place-items: center; cursor: grab; opacity: .55; }
      .grip:active { cursor: grabbing; }
      button { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 7px;
        height: 32px; padding: 0 12px; border-radius: 999px; background: rgba(255,255,255,.1); color: #fff; font: inherit; }
      button:hover { background: rgba(255,255,255,.2); }
      button.rec { background: #d93025; } button.rec:hover { background: #ea4335; }
      button.icon { padding: 0; width: 32px; justify-content: center; }
      svg { width: 15px; height: 15px; }
      .dot { width: 9px; height: 9px; border-radius: 50%; background: #ff5a4d; animation: p 1.2s infinite; }
      @keyframes p { 50% { opacity: .35; } }
      .time { font-variant-numeric: tabular-nums; min-width: 52px; }
      .note { position: absolute; top: 100%; left: 0; margin-top: 6px; max-width: 280px; padding: 8px 12px; border-radius: 10px;
        background: #3a1c24; color: #ffd9d9; font: 500 12px/1.4 "Segoe UI", system-ui, sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,.35); }
      .note.ok { background: #173325; color: #c9f2d9; }
      .ask { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); width: 340px; max-width: calc(100vw - 24px);
        padding: 14px 16px; border-radius: 16px; background: rgba(24,27,52,.97); color: #fff; box-shadow: 0 10px 40px rgba(0,0,0,.45);
        font: 500 13px/1.45 "Segoe UI", system-ui, sans-serif; border: 1px solid rgba(255,255,255,.12); }
      .ask h3 { margin: 0 0 4px; font-size: 15px; display: flex; align-items: center; gap: 8px; }
      .ask p { margin: 0 0 12px; color: #c9cbe6; }
      .ask kbd { background: rgba(255,255,255,.16); border-radius: 6px; padding: 2px 7px; font: 600 12px "Segoe UI", system-ui; color: #fff; white-space: nowrap; }
      .ask .row { display: flex; gap: 8px; justify-content: flex-end; }
      .ask .row button { height: 30px; font-size: 12.5px; }
      [hidden] { display: none !important; }
    </style>
    <div class="bar" id="bar">
      <div class="grip" id="grip" title="Drag to move"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.7"/><circle cx="15" cy="6" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18" r="1.7"/><circle cx="15" cy="18" r="1.7"/></svg></div>
      <button id="start" class="rec" title="Opens the recorder, then press Start"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="6"/></svg>Record</button>
      <span id="live" hidden style="display:inline-flex;align-items:center;gap:7px;padding:0 6px"><span class="dot"></span><span class="time" id="time">0:00</span></span>
      <button id="mark" class="icon" title="Add a bookmark here" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4z"/></svg></button>
      <button id="stop" title="Stop and save" hidden><svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>Stop</button>
      <button id="hide" class="icon" title="Hide this bar (turn it back on in Settings)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <div class="note" id="note" hidden></div>
    <div class="ask" id="ask" hidden>
      <h3><span class="dot"></span>Record this meeting?</h3>
      <p id="askHow"></p>
      <div class="row"><button id="askNever">Don't ask again</button><button id="askNo" class="rec">Not now</button></div>
    </div>`;
  const $ = (id) => root.getElementById(id);

  const send = (msg) => chrome.runtime.sendMessage({ target: "background", ...msg }).catch(() => null);
  let noteTimer;
  function note(text, ok) {
    const n = $("note");
    n.textContent = text;
    n.className = "note" + (ok ? " ok" : "");
    n.hidden = !text;
    clearTimeout(noteTimer);
    if (text) noteTimer = setTimeout(() => (n.hidden = true), ok ? 2200 : 9000);
  }

  // ---- position (remembered; stays on screen) ----
  let pos = { x: 20, y: 80 };
  function place() {
    const w = host.offsetWidth || 220;
    const h = host.offsetHeight || 44;
    pos.x = Math.min(Math.max(0, pos.x), Math.max(0, innerWidth - w));
    pos.y = Math.min(Math.max(0, pos.y), Math.max(0, innerHeight - h));
    host.style.left = pos.x + "px";
    host.style.top = pos.y + "px";
  }
  $("grip").addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const dx = e.clientX - pos.x;
    const dy = e.clientY - pos.y;
    const move = (ev) => {
      pos = { x: ev.clientX - dx, y: ev.clientY - dy };
      place();
    };
    const up = () => {
      removeEventListener("pointermove", move, true);
      removeEventListener("pointerup", up, true);
      chrome.storage.local.set({ dockPos: pos });
    };
    addEventListener("pointermove", move, true);
    addEventListener("pointerup", up, true);
  });
  addEventListener("resize", place);

  // ---- state ----
  let timer;
  const fmt = (ms) => {
    const s = Math.floor(ms / 1000);
    const p = (n) => String(n).padStart(2, "0");
    return s >= 3600 ? `${Math.floor(s / 3600)}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}` : `${Math.floor(s / 60)}:${p(s % 60)}`;
  };
  async function sync() {
    let st = {};
    try {
      st = await chrome.storage.session.get(["recording", "startedAt"]);
    } catch {}
    const rec = !!st.recording;
    if (rec) hideAsk();
    $("start").hidden = rec;
    $("live").hidden = !rec;
    $("mark").hidden = !rec;
    $("stop").hidden = !rec;
    clearInterval(timer);
    if (rec) {
      const tick = () => ($("time").textContent = fmt(Date.now() - st.startedAt));
      tick();
      timer = setInterval(tick, 1000);
    }
    place();
  }

  $("start").onclick = async () => {
    // Chrome only lets a recording start from the extension itself, so open its popup: one click on Start there
    const res = await send({ type: "open-popup" });
    if (res && res.ok) return;
    note("Click the Meet Recorder icon in the toolbar, or press Alt+Shift+S, or right-click this page → Meet Recorder → Start recording.", true);
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => ($("note").hidden = true), 9000);
  };
  $("stop").onclick = async () => {
    $("stop").disabled = true;
    await send({ type: "stop" });
    $("stop").disabled = false;
    note("Saving…", true);
  };
  $("mark").onclick = async () => {
    const res = await send({ type: "bookmark" });
    note(res && res.ok ? "Bookmark added ★" : "Not recording", !!(res && res.ok));
  };
  $("hide").onclick = async () => {
    const { settings = {} } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings: { ...settings, showDock: false } });
  };

  // ---- "Record this meeting?" prompt when I join a call ----
  // Chrome won't let an extension start a recording without a keypress/click on the extension itself,
  // so the prompt just tells me the one keypress.
  const asked = new Set();
  let wasInCall = false;
  let askTimer;
  const inCall = () => !!document.querySelector('[aria-label*="Leave call" i], [data-tooltip*="Leave call" i]');
  async function hideAsk() {
    clearTimeout(askTimer);
    $("ask").hidden = true;
  }
  async function showAsk() {
    const res = await send({ type: "shortcut" });
    const key = res && res.key;
    $("askHow").innerHTML =
      (key ? `Press <kbd>${key.replace(/\+/g, "</kbd> <kbd>")}</kbd> to start. ` : "") +
      `Or right-click this page → <b>Meet Recorder</b> → <b>Start recording</b>.`;
    $("ask").hidden = false;
    clearTimeout(askTimer);
    askTimer = setTimeout(hideAsk, 30000);
  }
  $("askNo").onclick = hideAsk;
  $("askNever").onclick = async () => {
    hideAsk();
    const { settings = {} } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings: { ...settings, autoRecord: "off" } });
  };
  setInterval(async () => {
    const now = inCall();
    if (now && !wasInCall && !asked.has(location.pathname)) {
      asked.add(location.pathname);
      let st = {};
      let cfg = {};
      try {
        st = await chrome.storage.session.get("recording");
        cfg = (await chrome.storage.local.get("settings")).settings || {};
      } catch {}
      if (!st.recording && cfg.autoRecord !== "off") showAsk();
    }
    if (!now && wasInCall) hideAsk();
    wasInCall = now;
  }, 2000);

  // ---- show / hide following the setting ----
  async function applyVisibility() {
    const { settings = {} } = await chrome.storage.local.get("settings");
    const show = settings.showDock !== false;
    if (!host.isConnected) document.documentElement.append(host);
    $("bar").hidden = !show;
    if (settings.autoRecord === "off") hideAsk();
    sync();
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) applyVisibility();
    if (area === "session") sync();
  });

  chrome.storage.local.get("dockPos").then(({ dockPos }) => {
    if (dockPos) pos = dockPos;
    applyVisibility();
  });
})();
