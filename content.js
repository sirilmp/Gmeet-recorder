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
// someone talks, the little sound bars in their tile are redrawn several times a second (Meet swaps
// classes on them); a silent tile hardly changes. So the recorder counts the attribute changes inside
// each tile and takes the busiest one as the speaker. Only changes go to the background (who, from
// when), which keeps them next to the bookmarks; the transcript lines get their names from it later.
const SPK_TICK = 400; // ms per check
const SPK_BUSY = 3; // attribute changes per check that count as "talking"
let spkObserver = null;
let spkTimer = null;
let spkChurn = new Map(); // tile -> changes since the last check
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
// ("More options for Sweta") are the fallback
function tileName(tile) {
  for (const n of tile.querySelectorAll(".notranslate")) {
    const t = n.textContent.trim();
    if (t && t.length <= 60) return selfName(t);
  }
  for (const b of tile.querySelectorAll("[aria-label]")) {
    const m = /(?:options for|^Pin) (.+?)(?: to your main screen)?$/i.exec(b.getAttribute("aria-label"));
    if (m) return selfName(m[1].trim());
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
  // add up per person (one person can have more than one tile, or nested tile elements)
  const byName = new Map();
  for (const [tile, n] of spkChurn) {
    if (!tile.isConnected) continue;
    const name = tileName(tile);
    if (name) byName.set(name, (byName.get(name) || 0) + n);
  }
  spkChurn = new Map();
  let best = null;
  let most = 0;
  for (const [name, n] of byName)
    if (n > most) {
      best = name;
      most = n;
    }
  if (most < SPK_BUSY) {
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

function spkStart() {
  spkStop();
  if (window !== window.top || !document.body) return;
  spkObserver = new MutationObserver((list) => {
    for (const r of list) {
      const t = r.target;
      if (t.nodeType !== 1 || t.tagName === "VIDEO") continue;
      const tile = t.closest("[data-participant-id]");
      // the tile itself changing (hover, layout) is not the sound bars
      if (tile && tile !== t) spkChurn.set(tile, (spkChurn.get(tile) || 0) + 1);
    }
  });
  spkObserver.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["class", "style"] });
  spkTimer = setInterval(spkCheck, SPK_TICK);
}

function spkStop() {
  if (spkObserver) spkObserver.disconnect();
  clearInterval(spkTimer);
  spkObserver = null;
  spkTimer = null;
  spkChurn = new Map();
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
