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
  } else if (kind === "rec-stop") {
    recording = false;
    watching = false;
  }
  if (kind !== "watch-leave") window.postMessage({ src: "meetrec-ext", msg: m.msg }, "*");
});
