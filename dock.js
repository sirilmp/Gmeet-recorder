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
      .bar { display: flex; align-items: center; gap: 2px; padding: 4px; border-radius: 12px;
        background: rgba(28,28,27,.92); color: #ececea; font: 550 13px/1 "MR Inter", Inter, ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif;
        box-shadow: 0 0 0 1px rgba(255,255,255,.08), 0 8px 28px rgba(0,0,0,.4); user-select: none; backdrop-filter: blur(12px); }
      .grip { width: 18px; height: 30px; display: grid; place-items: center; cursor: grab; opacity: .4; }
      .grip:hover { opacity: .75; }
      .grip:active { cursor: grabbing; }
      .grip svg { width: 13px; height: 13px; }
      button { all: unset; box-sizing: border-box; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;
        height: 30px; padding: 0 11px; border-radius: 8px; color: #ececea; font: inherit; transition: background .12s; }
      button:hover { background: rgba(255,255,255,.1); }
      button:focus-visible { box-shadow: 0 0 0 2px rgba(255,255,255,.5); }
      button.rec { background: #e5484d; color: #fff; } button.rec:hover { background: #ec5d5e; }
      button.icon { padding: 0; width: 30px; justify-content: center; color: #a3a39e; }
      button.icon:hover { color: #fff; }
      svg { width: 14px; height: 14px; }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: #ec5d5e; animation: p 1.6s ease-in-out infinite; flex: none; }
      @keyframes p { 50% { opacity: .35; } }
      @media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
      .live { display: inline-flex; align-items: center; gap: 7px; padding: 0 8px 0 6px; }
      .time { font: 500 12.5px/1 "MR Mono", "JetBrains Mono", ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; min-width: 38px; color: #fff; }
      .div { width: 1px; height: 16px; background: rgba(255,255,255,.12); margin: 0 2px; }
      .note { position: absolute; top: 100%; left: 0; margin-top: 6px; max-width: 280px; padding: 8px 11px; border-radius: 9px;
        background: rgba(28,28,27,.95); color: #f5b4b5; font: 500 12px/1.45 "MR Inter", Inter, ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif;
        box-shadow: 0 0 0 1px rgba(255,255,255,.08), 0 8px 28px rgba(0,0,0,.4); }
      .note.ok { color: #ececea; }
      .ask { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); width: 340px; max-width: calc(100vw - 24px);
        padding: 14px 16px; border-radius: 14px; background: rgba(28,28,27,.97); color: #ececea;
        box-shadow: 0 0 0 1px rgba(255,255,255,.08), 0 16px 48px rgba(0,0,0,.5);
        font: 400 13px/1.5 "MR Inter", Inter, ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif; }
      .ask h3 { margin: 0 0 4px; font-family: "MR Jakarta", "MR Inter", Inter, ui-sans-serif, system-ui, sans-serif; font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 8px; color: #fff; }
      .ask p { margin: 0 0 12px; color: #a3a39e; }
      .ask b { color: #ececea; font-weight: 550; }
      .ask kbd { background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.14); border-radius: 5px; padding: 1px 6px; font: 500 11.5px "MR Mono", "JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace; color: #fff; white-space: nowrap; }
      .ask .row { display: flex; gap: 6px; justify-content: flex-end; }
      .ask .row button { height: 30px; font-size: 12.5px; }
      .ask .row button:not(.rec) { color: #a3a39e; } .ask .row button:not(.rec):hover { color: #fff; }
      .ask .row button.rec { background: #ececea; color: #1a1a19; } .ask .row button.rec:hover { background: #fff; }
      [hidden] { display: none !important; }
    </style>
    <div class="bar" id="bar">
      <div class="grip" id="grip" title="Drag to move"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.7"/><circle cx="15" cy="6" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18" r="1.7"/><circle cx="15" cy="18" r="1.7"/></svg></div>
      <button id="start" class="rec" title="Opens the recorder, then press Start"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="5"/></svg>Record</button>
      <span id="live" class="live" hidden><span class="dot"></span><span class="time" id="time">0:00</span></span>
      <button id="mark" class="icon" title="Add a bookmark here" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4z"/></svg></button>
      <button id="stop" title="Stop and save" hidden><svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>Stop</button>
      <span class="div"></span><button id="hide" class="icon" title="Hide this bar (turn it back on in Settings)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <div class="note" id="note" hidden></div>
    <div class="ask" id="ask" hidden>
      <h3><span class="dot"></span>Record this meeting?</h3>
      <p id="askHow"></p>
      <div class="row"><button id="askNever">Don't ask again</button><button id="askNo" class="rec">Not now</button></div>
    </div>`;
  // The extension's fonts, under names of our own so Meet's styles are untouched. Loaded from bytes, since
  // Meet's page rules may not allow font files from the extension; until they arrive the fallbacks show.
  for (const [family, file] of [["MR Inter", "inter"], ["MR Jakarta", "plus-jakarta-sans"], ["MR Mono", "jetbrains-mono"]])
    fetch(chrome.runtime.getURL(`fonts/${file}-latin-wght-normal.woff2`))
      .then((r) => r.arrayBuffer())
      .then((buf) => new FontFace(family, buf, { weight: "100 900" }).load())
      .then((f) => document.fonts.add(f))
      .catch(() => {});
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
  // Alt+Shift+B on the Meet page. Chrome sends the same key to the extension as a shortcut only when it
  // assigned it (it can be unset in chrome://extensions/shortcuts, or taken by Chrome's "focus bookmarks bar")
  addEventListener(
    "keydown",
    (e) => {
      if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey || e.code !== "KeyB" || e.repeat) return;
      if ($("mark").hidden) return;
      e.preventDefault();
      e.stopPropagation();
      $("mark").click();
    },
    true
  );
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
