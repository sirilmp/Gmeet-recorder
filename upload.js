const CHUNK = 8 * 1024 * 1024; // must be a multiple of 256 KiB
const $ = (id) => document.getElementById(id);

function log(text, err = false) {
  const line = document.createElement("div");
  line.textContent = text;
  if (err) line.className = "err";
  $("log").appendChild(line);
}

function getToken(interactive = true) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error((chrome.runtime.lastError && chrome.runtime.lastError.message) || "No token"));
      } else {
        resolve(token);
      }
    });
  });
}

async function startSession(token, file) {
  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/webm",
        "X-Upload-Content-Length": String(file.size),
      },
      body: JSON.stringify({ name: file.name, mimeType: "video/webm" }),
    }
  );
  if (!res.ok) throw new Error(`Could not start upload (${res.status}): ${await res.text()}`);
  return res.headers.get("Location");
}

async function uploadFile(file) {
  const token = await getToken();
  const sessionUrl = await startSession(token, file);
  $("bar").hidden = false;
  $("bar").value = 0;

  let offset = 0;
  while (offset < file.size) {
    const end = Math.min(offset + CHUNK, file.size);
    const res = await fetch(sessionUrl, {
      method: "PUT",
      headers: { "Content-Range": `bytes ${offset}-${end - 1}/${file.size}` },
      body: file.slice(offset, end),
    });
    if (res.status === 308) {
      offset = end;
    } else if (res.ok) {
      offset = file.size;
    } else {
      throw new Error(`Upload failed (${res.status}): ${await res.text()}`);
    }
    $("bar").value = Math.round((offset / file.size) * 100);
  }
}

$("files").onchange = () => {
  $("go").disabled = !$("files").files.length;
};

$("go").onclick = async () => {
  $("go").disabled = true;
  for (const file of $("files").files) {
    try {
      log(`Uploading ${file.name}…`);
      await uploadFile(file);
      log(`Done: ${file.name}`);
    } catch (e) {
      log(`${file.name}: ${e.message}`, true);
    }
  }
  $("go").disabled = false;
};
