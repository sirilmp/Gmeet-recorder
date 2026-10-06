// Bridge between the page-world hook (share-hook.js) and the extension.
const toRecorder = (msg) => {
  try {
    chrome.runtime.sendMessage({ target: "offscreen", type: "share-signal", msg }).catch(() => {});
  } catch {
    /* extension was reloaded; refresh the Meet tab */
  }
};

window.addEventListener("message", (e) => {
  if (e.source !== window || !e.data || e.data.src !== "meetrec-main") return;
  toRecorder(e.data.msg);
});

let recording = false; // tab mode: also report presenting
let watching = false; // any mode: report leaving the call
let lastPresenting = null;
let seenInCall = false;
let missing = 0;
let lastMuted = null;

// Checked often so my voice is cut right when I mute in Meet
if (window === window.top) {
  setInterval(() => {
    if (!recording) return;
    const m = meetMuted();
    if (m !== null && m !== lastMuted) {
      lastMuted = m;
      toRecorder({ kind: "meet-muted", muted: m });
    }
  }, 250);
}

// Only cheap attribute queries: reading body.innerText forced a full page layout every check
function isPresenting() {
  return !!document.querySelector(
    '[aria-label*="Stop presenting" i], [data-tooltip*="Stop presenting" i], [aria-label*="are presenting" i]'
  );
}

// Meet's own mic button: data-is-muted="true" while I'm muted (null if the button isn't found)
function meetMuted() {
  const b = document.querySelector('button[data-is-muted][aria-label*="microphone" i]');
  return b ? b.getAttribute("data-is-muted") === "true" : null;
}

// The red "Leave call" button exists only while I'm in the call
function inCall() {
  return !!document.querySelector('[aria-label*="Leave call" i], [data-tooltip*="Leave call" i]');
}

if (window === window.top) {
  setInterval(() => {
    if (recording) {
      const on = isPresenting();
      if (on !== lastPresenting) {
        lastPresenting = on;
        toRecorder({ kind: "presenting", on });
      }
    }
    if (watching) {
      if (inCall()) {
        seenInCall = true;
        missing = 0;
      } else if (seenInCall && ++missing >= 2) {
        // Gone for ~4 s: I left, or the host ended the call
        watching = false;
        try {
          chrome.runtime.sendMessage({ target: "background", type: "left-meeting" }).catch(() => {});
        } catch {
          /* extension was reloaded */
        }
      }
    }
  }, 2000);
}

// ---------- who is speaking ----------
// Meet marks every video tile with data-participant-id and writes the person's name in it. While
// someone talks, Meet changes the classes of a few elements in their tile (the sound bars, the
// highlight ring) and changes them back when they stop. The recorder notes for each such element the
// class it rests in, and a tile counts as talking while an element in it is away from its resting
// class or keeps changing. That works whether Meet redraws the bars many times a second or only flips
// a class when talking starts and stops. Only changes go to the background (who, from when), which
// keeps them next to the bookmarks; the transcript lines get their names from it later.
const SPK_TICK = 400; // ms per check
const SPK_WINDOW = 1200; // ms of recent changes that count
const SPK_STUCK = 30000; // an element away from its resting class this long (with no more changes) rests there now
let spkObserver = null;
let spkTimer = null;
let spkEls = new Map(); // element -> { tile, rest: resting class, last: ms of its last change, n: recent change times }
let spkSaid = undefined; // the name last reported (null = nobody)
let spkNext = null; // a new name seen once: switch when it's seen twice in a row
let spkQuiet = 0; // checks in a row with nobody talking
let spkTiles = -1;

const toBackground = (msg) => {
  try {
    chrome.runtime.sendMessage({ target: "background", ...msg }).catch(() => {});
  } catch {
    /* extension was reloaded */
  }
};

// The name label is marked notranslate (Google's convention for people's names); the tile's buttons
// ("More options for Sweta") are the fallback. Meet's icons are text too ("keep_outline",
// "frame_person" drawn by an icon font) and are also marked notranslate, so those are skipped.
const iconName = (t) => /^[a-z0-9]+(_[a-z0-9]+)+$/.test(t);
function isIcon(el, t) {
  if (iconName(t)) return true;
  for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
    if (e.matches("[data-participant-id]")) break;
    if (e.matches("button, [role=button], [aria-hidden=true], svg") || /icon|symbol/i.test(e.getAttribute("class") || "")) return true;
  }
  return false;
}

function tileName(tile) {
  for (const n of tile.querySelectorAll(".notranslate")) {
    if (n.childElementCount) continue; // the label itself, not a box around icons and text
    const t = n.textContent.trim();
    if (t && t.length <= 60 && !isIcon(n, t)) return selfName(t);
  }
  for (const b of tile.querySelectorAll("[aria-label]")) {
    const m = /(?:options for|^Pin) (.+?)(?: to your main screen)?$/i.exec(b.getAttribute("aria-label"));
    if (m) return selfName(m[1].trim());
  }
  // last resort: the first short line of text in the tile that isn't an icon
  const walk = document.createTreeWalker(tile, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const t = n.nodeValue.trim();
    if (t.length < 2 || t.length > 60 || /^[a-z0-9_]+$/.test(t)) continue;
    if (n.parentElement && isIcon(n.parentElement, t)) continue;
    return selfName(t);
  }
  return null;
}

// My own tile says "You": use my Meet name when the page has it
function selfName(t) {
  t = t.replace(/\s*\((?:you|presentation|presenting)\)$/i, "").trim();
  if (!/^you$/i.test(t)) return t;
  const me = document.querySelector("[data-self-name]");
  const n = me && me.getAttribute("data-self-name");
  return n && !/^you$/i.test(n.trim()) ? n.trim() : "You";
}

// lag: how long ago it really changed (it takes a few checks to be sure)
function spkReport(name, lag) {
  if (name === spkSaid) return;
  spkSaid = name;
  toBackground({ type: "speaker", name, lag });
}

function spkCheck() {
  const tiles = document.querySelectorAll("[data-participant-id]").length;
  if (tiles !== spkTiles) {
    spkTiles = tiles;
    toBackground({ type: "diag", patch: { speakerTiles: tiles } });
  }
  // a score per person (one person can have more than one tile, or nested tile elements)
  const now = Date.now();
  const byName = new Map(); // name -> { score, last }
  const names = new Map(); // tile -> name, looked up once per check
  for (const [e, st] of spkEls) {
    if (!e.isConnected || !st.tile.isConnected) {
      spkEls.delete(e);
      continue;
    }
    st.n = st.n.filter((t) => now - t < SPK_WINDOW);
    let away = st.rest !== null && attrState(e) !== st.rest;
    if (away && now - st.last > SPK_STUCK) {
      st.rest = attrState(e);
      away = false;
    }
    // away from rest, or changing again and again (and not settled back at rest since)
    if ((!away && (st.n.length < 2 || now - st.last > 500)) || st.hov > st.other) continue;
    if (!names.has(st.tile)) names.set(st.tile, tileName(st.tile));
    const name = names.get(st.tile);
    if (!name) continue;
    const b = byName.get(name) || { score: 0, last: 0 };
    b.score += st.n.length + (away ? 1 : 0);
    b.last = Math.max(b.last, st.last);
    byName.set(name, b);
  }
  // the most activity wins; on a tie, whoever started changing last (they just began talking)
  let best = null;
  let most = 0;
  let bestLast = 0;
  for (const [name, b] of byName)
    if (b.score > most || (b.score === most && b.last > bestLast)) {
      best = name;
      most = b.score;
      bestLast = b.last;
    }
  if (!best) {
    spkNext = null;
    // a short pause between words is not "nobody"
    if (++spkQuiet >= 4) spkReport(null, spkQuiet * SPK_TICK);
    return;
  }
  spkQuiet = 0;
  if (best === spkSaid) spkNext = null;
  else if (best === spkNext) spkReport(best, 2 * SPK_TICK);
  else if (spkSaid == null) spkReport(best, SPK_TICK);
  else spkNext = best;
}

let spkHover = new WeakMap(); // tile -> ms the mouse last went over or off it
function spkOnMouse(e) {
  const tile = e.target && e.target.closest && e.target.closest("[data-participant-id]");
  if (tile) for (let t = tile; t; t = t.parentElement && t.parentElement.closest("[data-participant-id]")) spkHover.set(t, Date.now());
}

const attrState = (e) => (e.getAttribute("class") || "") + "|" + (e.getAttribute("style") || "");

function spkStart() {
  spkStop();
  if (window !== window.top || !document.body) return;
  spkObserver = new MutationObserver((list) => {
    const now = Date.now();
    for (const r of list) {
      const t = r.target;
      if (t.nodeType !== 1 || t.tagName === "VIDEO") continue;
      const tile = t.closest("[data-participant-id]");
      // the tile itself changing (hover, layout) is not the sound bars, nor is the name label
      if (!tile || tile === t || t.closest(".notranslate")) continue;
      let st = spkEls.get(t);
      if (!st) {
        // first change seen: what it was before is where it rests
        const other = r.attributeName === "class" ? "style" : "class";
        const before = r.oldValue == null ? "" : r.oldValue;
        const was = other === "style" ? before + "|" + (t.getAttribute("style") || "") : (t.getAttribute("class") || "") + "|" + before;
        st = { tile, rest: was, last: now, n: [], hov: 0, other: 0 };
        spkEls.set(t, st);
      }
      // the mouse moving over or off a tile changes its buttons and rings too: elements that mostly
      // change right after that are left out
      if (now - (spkHover.get(tile) || 0) < 600) st.hov++;
      else st.other++;
      st.last = now;
      st.n.push(now);
      if (st.n.length > 40) st.n.splice(0, st.n.length - 40);
    }
  });
  document.addEventListener("mouseover", spkOnMouse, true);
  document.addEventListener("mouseout", spkOnMouse, true);
  spkObserver.observe(document.body, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["class", "style"] });
  spkTimer = setInterval(spkCheck, SPK_TICK);
}

function spkStop() {
  if (spkObserver) spkObserver.disconnect();
  document.removeEventListener("mouseover", spkOnMouse, true);
  document.removeEventListener("mouseout", spkOnMouse, true);
  clearInterval(spkTimer);
  spkObserver = null;
  spkTimer = null;
  spkEls = new Map();
  spkSaid = undefined;
  spkNext = null;
  spkQuiet = 0;
  spkTiles = -1;
}

chrome.runtime.onMessage.addListener((m) => {
  if (m.target !== "tab") return;
  const kind = m.msg && m.msg.kind;
  if (kind === "rec-start" || kind === "watch-leave") {
    recording = kind === "rec-start";
    lastMuted = null;
    lastPresenting = null; // report the current state straight away
    watching = true;
    seenInCall = false;
    missing = 0;
    if (recording) spkStart();
  } else if (kind === "rec-stop") {
    recording = false;
    watching = false;
    spkStop();
  }
  if (kind !== "watch-leave") window.postMessage({ src: "meetrec-ext", msg: m.msg }, "*");
});
