// A small floating control bar on the Meet page: Record / Stop / Bookmark. Drag it anywhere.
// Drawn in a shadow root so Meet's styles can't touch it (and it can't touch Meet's).
(() => {
  if (window.top !== window) return;
  if (document.getElementById("meet-recorder-dock")) return;

  const host = document.createElement("div");
  host.id = "meet-recorder-dock";
  host.style.cssText = "position:fixed;z-index:2147483646;left:0;top:0;";
  const root = host.attachShadow({ mode: "closed" });
  const CSS = `
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
      .lbl, #pip .in { display: none; }
      /* Popped out into its own always-on-top window: a small control panel, timer on the left, actions on the
         right; the window's own frame moves and closes it. Scaled down to fit when the window is narrow. */
      html.pip, html.pip body { margin: 0; height: 100%; background: #1c1c1b; color-scheme: dark; overflow: hidden; }
      html.pip body { display: flex; align-items: center; }
      .pip .bar { flex: 1; min-width: 0; gap: 6px; padding: 0 12px; border-radius: 0; background: none; box-shadow: none; backdrop-filter: none; }
      .pip .bar > * { flex: none; }
      .pip .grip, .pip .div, .pip #hide { display: none; }
      .pip .live { margin-right: auto; padding: 0; gap: 9px; }
      .pip .dot { width: 9px; height: 9px; }
      .pip .time { font-size: 17px; font-weight: 500; letter-spacing: -.01em; min-width: 0; }
      .pip #start { margin-right: auto; height: 32px; padding: 0 14px; }
      .pip button { height: 32px; }
      .pip #mark, .pip #stop { width: auto; padding: 0 12px 0 10px; background: rgba(255,255,255,.07); color: #ececea; }
      .pip #mark:hover, .pip #stop:hover { background: rgba(255,255,255,.13); }
      .pip #stop svg { color: #ec5d5e; }
      .pip .lbl { display: inline; }
      .pip #pip { width: 28px; margin-left: 2px; }
      .pip #pip .out { display: none; } .pip #pip .in { display: block; }
      .pip .note { top: 50%; left: 8px; right: 8px; max-width: none; margin: 0; transform: translateY(-50%); padding: 7px 10px;
        background: #2a2a28; box-shadow: 0 0 0 1px rgba(255,255,255,.08); text-align: center; }
`;
  root.innerHTML = `
    <style>${CSS}</style>
    <div class="bar" id="bar">
      <div class="grip" id="grip" title="Drag to move"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.7"/><circle cx="15" cy="6" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18" r="1.7"/><circle cx="15" cy="18" r="1.7"/></svg></div>
      <button id="start" class="rec" title="Start recording this meeting"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="5"/></svg>Record</button>
      <span id="live" class="live" hidden><span class="dot"></span><span class="time" id="time">0:00</span></span>
      <button id="mark" class="icon" title="Add a bookmark here" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4z"/></svg><span class="lbl">Bookmark</span></button>
      <button id="stop" title="Stop and save" hidden><svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>Stop</button>
      <button id="pip" class="icon" title="Pop out: keep this bar on top of every tab and window" hidden><svg class="out" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="11" width="6" height="5" rx="1" fill="currentColor"/></svg><svg class="in" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4"/><path d="M20 4l-7 7M13 6.5V11h4.5"/></svg></button>
      <span class="div"></span><button id="hide" class="icon" title="Close for this meeting (turn it off for good in Settings)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <div class="note" id="note" hidden></div>
    <div class="ask" id="ask" hidden>
      <h3><span class="dot"></span>Record this meeting?</h3>
      <p id="askHow"></p>
      <div class="row"><button id="askNever">Don't ask again</button><button id="askNo" class="rec">Not now</button></div>
    </div>`;
  // The extension's fonts, under names of our own so Meet's styles are untouched. Loaded from bytes, since
  // Meet's page rules may not allow font files from the extension; until they arrive the fallbacks show.
  const fonts = [];
  for (const [family, file] of [["MR Inter", "inter"], ["MR Jakarta", "plus-jakarta-sans"], ["MR Mono", "jetbrains-mono"]])
    fetch(chrome.runtime.getURL(`fonts/${file}-latin-wght-normal.woff2`))
      .then((r) => r.arrayBuffer())
      .then((buf) => new FontFace(family, buf, { weight: "100 900" }).load())
      .then((f) => {
        fonts.push(f);
        document.fonts.add(f);
        if (pipWin) pipWin.document.fonts.add(f), fitPip();
      })
      .catch(() => {});
  // Looked up once: the bar and its note move into the pop-out window and back, out of this shadow root
  const els = {};
  for (const el of root.querySelectorAll("[id]")) els[el.id] = el;
  const $ = (id) => els[id];

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
  let wasRec = false;
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
    if (!rec && feed && feed.live) stopFeed(); // the recording ended: stop sharing the tab
    if (!rec && wasRec && pipAuto) closePip();
    wasRec = rec;
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
    fitPip();
  }

  // ---- sharing this tab with the recorder ----
  // Chrome lets the extension capture a tab only after a click on the extension itself (toolbar icon,
  // shortcut, right-click menu). A click here doesn't count, so the page shares its own tab instead
  // (Chrome asks "Share this tab?") and sends it to the recorder over a local WebRTC link.
  let feed = null; // { stream, pc, ice, live }
  const toRecorder = (msg) => chrome.runtime.sendMessage({ target: "offscreen", type: "feed-signal", ...msg }).catch(() => {});
  function stopFeed() {
    if (!feed) return;
    if (feed.pc) feed.pc.close();
    feed.stream.getTracks().forEach((t) => t.stop());
    feed = null;
  }
  async function shareTab() {
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { max: 30 } },
        audio: { suppressLocalAudioPlayback: false },
        preferCurrentTab: true,
        selfBrowserSurface: "include",
        surfaceSwitching: "exclude",
        systemAudio: "exclude",
        monitorTypeSurfaces: "exclude",
      });
    } catch {
      return "Not started: the share prompt was closed.";
    }
    const [v] = stream.getVideoTracks();
    if (!stream.getAudioTracks().length || (v && v.getSettings().displaySurface !== "browser")) {
      stream.getTracks().forEach((t) => t.stop());
      return "Not started: share this tab, with “Also share tab audio” on, so the voices are recorded.";
    }
    feed = { stream, pc: null, ice: [], live: false };
    // Chrome's "Stop sharing" ends the recording too
    v.addEventListener("ended", () => {
      if (!feed || feed.stream !== stream) return;
      stopFeed();
      send({ type: "stop" });
      note("Saving…", true);
    });
    const res = await send({ type: "dock-start", feed: true });
    if (res && res.ok) {
      if (feed) feed.live = true;
      return null;
    }
    stopFeed();
    return (res && res.error) || "Couldn't start the recording.";
  }
  async function answerFeed(o) {
    if (!feed) return;
    if (feed.pc) feed.pc.close();
    const pc = (feed.pc = new RTCPeerConnection({ iceServers: [] }));
    const mine = feed;
    pc.onicecandidate = (e) => {
      if (e.candidate && feed === mine && mine.pc === pc) toRecorder({ kind: "ice", candidate: e.candidate.toJSON() });
    };
    await pc.setRemoteDescription({ type: "offer", sdp: o.sdp });
    const [v] = mine.stream.getVideoTracks();
    const [a] = mine.stream.getAudioTracks();
    v.applyConstraints({ width: { max: o.w }, height: { max: o.h }, frameRate: { max: o.fps } }).catch(() => {});
    for (const t of pc.getTransceivers()) {
      await t.sender.replaceTrack(t.receiver.track.kind === "video" ? v : a);
      t.direction = "sendonly";
    }
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    // A local link: spend the bits on a sharp picture
    for (const sn of pc.getSenders()) {
      if (!sn.track || sn.track.kind !== "video") continue;
      const prm = sn.getParameters();
      prm.degradationPreference = "maintain-resolution";
      if (prm.encodings && prm.encodings[0]) prm.encodings[0].maxBitrate = 8_000_000;
      sn.setParameters(prm).catch(() => {});
    }
    toRecorder({ kind: "answer", sdp: answer.sdp });
    for (const c of mine.ice.splice(0)) pc.addIceCandidate(c).catch(() => {});
  }
  chrome.runtime.onMessage.addListener((m) => {
    if (m.target !== "tab" || !m.msg || !feed) return;
    if (m.msg.kind === "feed-offer") answerFeed(m.msg).catch((e) => console.warn("[Meet Recorder] feed", e));
    else if (m.msg.kind === "feed-ice") {
      if (feed.pc && feed.pc.remoteDescription) feed.pc.addIceCandidate(m.msg.candidate).catch(() => {});
      else feed.ice.push(m.msg.candidate);
    }
  });

  // ---- pop-out window ----
  // Chrome's Document Picture-in-Picture: a small always-on-top window that stays over every tab and app,
  // so Bookmark and Stop are at hand after I switch away from Meet. The bar itself moves into the window
  // (its buttons keep working as they are) and comes back to the page when the window closes.
  // Chrome opens it only straight after a click on the page, and only one such window at a time.
  const canPip = "documentPictureInPicture" in window;
  let pipWin = null;
  let pipAuto = false; // opened by Record, so it closes again when that recording ends
  async function openPip(auto) {
    if (!canPip || pipWin) return pipWin;
    let w;
    try {
      w = await documentPictureInPicture.requestWindow({ width: 360, height: 64 });
    } catch (e) {
      if (!auto) note("Couldn't pop out the bar: click the pop-out button again.", false);
      return null;
    }
    pipWin = w;
    pipAuto = auto;
    const doc = w.document;
    doc.title = "Meet Recorder";
    const style = doc.createElement("style");
    style.textContent = CSS;
    doc.head.append(style);
    doc.documentElement.className = "pip";
    for (const f of fonts) doc.fonts.add(f);
    doc.body.append($("bar"), $("note"));
    $("pip").title = "Put this bar back on the Meet page";
    w.addEventListener("keydown", markKey, true);
    w.addEventListener("resize", fitPip);
    fitPip();
    w.addEventListener("pagehide", () => {
      if (pipWin !== w) return;
      pipWin = null;
      root.append($("bar"), $("note"));
      $("pip").title = "Pop out: keep this bar on top of every tab and window";
      applyVisibility();
    });
    return w;
  }
  const closePip = () => pipWin && pipWin.close();
  // Shrink the controls to fit a narrow window (or a zoomed-in Meet, whose zoom the window takes on)
  function fitPip() {
    const bar = $("bar");
    bar.style.zoom = "";
    if (!pipWin) return;
    const z = Math.min(1, (pipWin.innerWidth - 4) / bar.scrollWidth, (pipWin.innerHeight - 4) / bar.scrollHeight);
    if (z < 1) bar.style.zoom = String(Math.max(0.5, z));
  }
  $("pip").hidden = !canPip;
  $("pip").onclick = () => (pipWin ? closePip() : openPip(false));

  $("start").onclick = async () => {
    $("start").disabled = true;
    let popped = false;
    try {
      // Pop out now, while Chrome still counts the click; Meet's own pop-out (if it has one open) is left alone
      if (canPip && !pipWin && !documentPictureInPicture.window) {
        const { settings = {} } = await chrome.storage.local.get("settings");
        if (settings.dockPip !== false) popped = !!(await openPip(true));
      }
      // Starts with the popup's saved choices
      const res = await send({ type: "dock-start" });
      if (res && res.ok) return;
      const err = res && res.needShare ? await shareTab() : (res && res.error) || "Couldn't start the recording.";
      if (err) {
        if (popped) closePip();
        note(err, false);
      }
    } finally {
      $("start").disabled = false;
    }
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
  function markKey(e) {
    if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey || e.code !== "KeyB" || e.repeat) return;
    if ($("mark").hidden) return;
    e.preventDefault();
    e.stopPropagation();
    $("mark").click();
  }
  addEventListener("keydown", markKey, true);
  // Closing the bar hides it for this meeting only; it comes back next meeting. Settings turns it off for good.
  let closedFor = null;
  $("hide").onclick = () => {
    closedFor = location.pathname;
    $("bar").hidden = true;
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
    if (closedFor && closedFor !== location.pathname) applyVisibility(); // moved on to another meeting
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
    if (closedFor && closedFor !== location.pathname) closedFor = null;
    const show = settings.showDock !== false && !closedFor;
    if (!host.isConnected) document.documentElement.append(host);
    $("bar").hidden = !show;
    if (!show) closePip();
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
