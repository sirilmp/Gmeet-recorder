// Runs inside the Meet page (MAIN world). When I switch away from a meeting tab, Chrome pops the meeting
// out into a floating window by itself: it calls the page's "enterpictureinpicture" media-session handler
// (Meet sets one for its own pop-out) and lets that handler open a window without a click. While a
// recording runs, dock.js marks <html data-mr-autopip="1"> and the switch pops out the recorder's bar
// instead; the rest of the time Meet's own handler runs as before.
(() => {
  if (window !== window.top || window.__meetRecAutoPip || !("mediaSession" in navigator)) return;
  window.__meetRecAutoPip = true;
  const ms = navigator.mediaSession;
  const setHandler = MediaSession.prototype.setActionHandler;
  const ACTION = "enterpictureinpicture";
  let meets = null; // Meet's handler
  const ours = () => document.documentElement.dataset.mrAutopip === "1";
  function onEnter(details) {
    if (ours()) document.dispatchEvent(new CustomEvent("meet-recorder-autopip"));
    else if (meets) meets.call(ms, details);
  }
  function apply() {
    try {
      setHandler.call(ms, ACTION, ours() || meets ? onEnter : null);
    } catch {
      /* this Chrome has no automatic pop-out */
    }
  }
  MediaSession.prototype.setActionHandler = function (action, handler) {
    if (this !== ms || action !== ACTION) return setHandler.call(this, action, handler);
    meets = handler || null;
    apply();
  };
  new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ["data-mr-autopip"] });
})();
