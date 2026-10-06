// Offscreen documents can't show permission prompts, so grant mic access once from a normal page.
navigator.mediaDevices
  .getUserMedia({ audio: true })
  .then((s) => {
    s.getTracks().forEach((t) => t.stop());
    document.getElementById("msg").textContent = "Microphone access granted. You can close this tab.";
    setTimeout(() => window.close(), 1500);
  })
  .catch((e) => {
    document.getElementById("msg").textContent = "Microphone access was blocked: " + e.message;
  });
