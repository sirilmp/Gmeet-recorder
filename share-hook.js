// Runs inside the Meet page (MAIN world). Meet only shows a "You're presenting" panel in its own tab,
// so the extension grabs the screen-share stream Meet creates and sends the video to the recorder
// (offscreen document) over a local WebRTC connection. Signalling goes through content.js.
(() => {
  if (window.__meetRecHook) return;
  window.__meetRecHook = true;

  let track = null; // Meet's current screen-share video track
  let audioTrack = null; // its audio (only if "share tab/system audio" was ticked)
  let pc = null;
  let recActive = false;
  let poll = null;
  let micTrack = null; // the mic Meet is using (the recorder follows it on "Auto")

  function reportMic() {
    if (recActive && micTrack && micTrack.label) post({ kind: "meet-mic", label: micTrack.label });
  }
  // The speaker Meet plays the call to (Meet's "Speakers" setting). Capturing the tab mutes Meet,
  // and the recorder plays the sound again; it has to use the same device. With a Bluetooth headset
  // on Windows that matters a lot: once the headset's mic is in use, only its "Hands-Free" output
  // carries sound, so playing to the system default ("Headphones") gives silence or stutter.
  let speakerId = null; // last sinkId Meet set; null = not seen yet
  let reportedSpeaker;
  async function reportSpeaker() {
    if (!recActive || window !== window.top) return;
    let id = speakerId;
    if (id == null) {
      const el = [...document.querySelectorAll("audio, video")].find((e) => typeof e.sinkId === "string" && e.sinkId);
      id = el ? el.sinkId : "";
    }
    let label = "";
    if (id && id !== "default") {
      try {
        const d = (await navigator.mediaDevices.enumerateDevices()).find((x) => x.kind === "audiooutput" && x.deviceId === id);
        label = d ? d.label : "";
      } catch {
        /* keep default */
      }
    }
    if (label === reportedSpeaker) return;
    reportedSpeaker = label;
    post({ kind: "meet-speaker", label });
  }
  for (const proto of [window.HTMLMediaElement && HTMLMediaElement.prototype, window.AudioContext && AudioContext.prototype]) {
    const original = proto && proto.setSinkId;
    if (!original) continue;
    proto.setSinkId = function (id, ...rest) {
      const r = original.call(this, id, ...rest);
      if (typeof id === "string") {
        speakerId = id;
        Promise.resolve(r).then(reportSpeaker, () => {});
      }
      return r;
    };
  }
  navigator.mediaDevices?.addEventListener?.("devicechange", () => reportSpeaker());

  function onUserMedia(stream) {
    const t = stream.getAudioTracks()[0];
    if (!t || window !== window.top) return;
    micTrack = t;
    reportMic();
  }

  const post = (msg) => window.postMessage({ src: "meetrec-main", msg }, "*");

  function stopSend(notify) {
    if (pc) {
      pc.close();
      pc = null;
    }
    if (notify) post({ kind: "share-stop" });
  }

  async function send() {
    if (!track || !recActive || pc) return;
    const p = (pc = new RTCPeerConnection({ iceServers: [] }));
    const ms = new MediaStream([track]);
    p.addTrack(track, ms);
    if (audioTrack && audioTrack.readyState === "live") p.addTrack(audioTrack, ms);
    p.onicecandidate = (e) => {
      if (e.candidate && pc === p) post({ kind: "ice", candidate: e.candidate.toJSON() });
    };
    const offer = await p.createOffer();
    await p.setLocalDescription(offer);
    post({ kind: "offer", sdp: offer.sdp });
  }

  function end(t) {
    if (t !== track) return;
    track = null;
    audioTrack = null;
    clearInterval(poll);
    stopSend(true);
  }

  function onShare(stream) {
    const t = stream.getVideoTracks()[0];
    if (!t) return;
    track = t;
    audioTrack = stream.getAudioTracks()[0] || null;
    post({ kind: "share-detected", audio: !!audioTrack });
    t.addEventListener("ended", () => end(t));
    // track.stop() called by Meet itself doesn't fire "ended", so poll as well
    clearInterval(poll);
    poll = setInterval(() => {
      if (track && track.readyState === "ended") end(track);
    }, 500);
    if (recActive) send();
  }

  // Patch getDisplayMedia in this window and in any iframe Meet creates (it may call it from a
  // fresh iframe, which would otherwise have an unpatched copy)
  function patch(win) {
    try {
      const proto = win.MediaDevices && win.MediaDevices.prototype;
      if (!proto || proto.__meetRecPatched || !proto.getDisplayMedia) return;
      const original = proto.getDisplayMedia;
      proto.getDisplayMedia = async function (...args) {
        const stream = await original.apply(this, args);
        try {
          onShare(stream);
        } catch (e) {
          console.warn("[Meet Recorder] share hook failed", e);
        }
        return stream;
      };
      // Also watch getUserMedia: tells us which mic Meet picked (or switched to)
      const originalUM = proto.getUserMedia;
      if (originalUM) {
        proto.getUserMedia = async function (...args) {
          const stream = await originalUM.apply(this, args);
          try {
            onUserMedia(stream);
          } catch {
            /* ignore */
          }
          return stream;
        };
      }
      proto.__meetRecPatched = true;
    } catch {
      /* cross-origin frame */
    }
  }
  patch(window);
  for (const [cls, prop, toWin] of [
    [HTMLIFrameElement, "contentWindow", (v) => v],
    [HTMLIFrameElement, "contentDocument", (v) => v && v.defaultView],
  ]) {
    const d = Object.getOwnPropertyDescriptor(cls.prototype, prop);
    if (!d || !d.get) continue;
    Object.defineProperty(cls.prototype, prop, {
      ...d,
      get() {
        const v = d.get.call(this);
        const w = toWin(v);
        if (w) patch(w);
        return v;
      },
    });
  }

  window.addEventListener("message", async (e) => {
    if (e.source !== window || !e.data || e.data.src !== "meetrec-ext") return;
    const m = e.data.msg;
    try {
      if (m.kind === "rec-start") {
        recActive = true;
        if (window === window.top) post({ kind: "hook-ready" });
        reportMic(); // the mic Meet already had open before the recording started
        reportedSpeaker = undefined;
        reportSpeaker(); // and the speaker it already plays to
        if (track) send(); // already presenting when the recording started
      } else if (m.kind === "rec-stop") {
        recActive = false;
        stopSend(false);
      } else if (m.kind === "answer" && pc) {
        await pc.setRemoteDescription({ type: "answer", sdp: m.sdp });
      } else if (m.kind === "ice" && pc) {
        await pc.addIceCandidate(m.candidate);
      }
    } catch (err) {
      console.warn("[Meet Recorder] signalling error", err);
    }
  });
})();
