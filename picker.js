// Runs in a small extension window so Chrome's screen picker has a window to attach to.
function pick() {
  // "audio" adds the "Share system/tab audio" checkbox to Chrome's picker
  chrome.desktopCapture.chooseDesktopMedia(["screen", "window", "tab", "audio"], async (id, options) => {
    if (id) {
      const audio = !!(options && options.canRequestAudioTrack);
      await chrome.runtime.sendMessage({ target: "background", type: "picked", id, audio });
      window.close();
    } else {
      document.getElementById("hint").textContent = "Nothing selected. Try again or cancel.";
    }
  });
}

document.getElementById("choose").onclick = pick;
document.getElementById("cancel").onclick = () => window.close();
pick(); // open the picker straight away; the button is the fallback
