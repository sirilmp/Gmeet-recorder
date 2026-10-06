# Meet Recorder (Chrome extension)

Records a Google Meet tab (video + shared screen + all participants' audio) plus your microphone,
saves it to `Downloads/MeetRecordings`, lists every recording (meeting name, date, length, size) inside
the extension, and uploads to Google Drive on demand. No backend required.

## Install
1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `F:\meet-recorder`.
2. Click the icon → **Grant microphone access** (one time).
3. Optional but recommended: extension **Details** → enable **Allow access to file URLs**
   (lets Drive upload read the saved file without a file picker).

## Record
1. Open the Meet tab (active tab), click the icon. The meeting name is prefilled from the tab title
   (edit it if you like) → **Start recording**. A red `REC` badge shows.
2. **Stop & save** → saved as `Downloads/MeetRecordings/<Meeting name> <date_time>.webm`.

## My recordings
Icon → **My recordings & Drive upload**. Per recording: **Open** (default video player),
**Show in folder**, **Upload to Drive**, **Delete**. Uploaded items get an "On Drive" badge and a link.

## Who said what
While recording, the extension watches Meet's video tiles and notes who is talking (the sound bars in a
person's tile move while they speak). The transcript lines then start with that name, e.g.
`[00:01:04] Sweta: …`, in the player, the captions, Copy, the .txt / .vtt files and on Drive. The popup's
Live status shows who it sees speaking right now.
- It only sees people whose tile is on screen, so in a big call with hidden tiles some lines stay unnamed.
  Two people talking at once get one name.
- In the player, click a name to change it (for all of that person's lines at once, e.g. "You" → your
  name), or hover a line without one and click **+ Name**.

## Google Drive setup (one time)
1. Google Cloud Console → new project → enable **Google Drive API**.
2. OAuth consent screen → add yourself as a test user.
3. Credentials → **OAuth client ID** → type **Chrome extension**, item ID = this extension's ID.
4. Put it in `manifest.json` → `oauth2.client_id`, then reload the extension.
Scope is `drive.file` (only files this extension creates).

## Share a recording (with its transcript and notes)
Each upload goes to its own Drive folder, named after the meeting: `Meet Recordings / <date> / <meeting> <time> /` with the video,
`<recording> transcript.txt` and `<recording>.meetrec.json` (name, date, length, bookmarks with notes and
the transcript). A transcript made later, or edited notes, are sent to that folder again automatically.
1. On an uploaded recording open the Drive menu → **Who can view the folder**, or share the folder
   with someone in Drive, then **Copy share link**.
2. The other person clicks **Import** in their library and pastes the link. Their own Drive must be
   connected (that's how the extension reads folders shared with them). They can also download the
   folder from Drive and choose (or drop) the .zip instead, no Drive connection needed.

Recordings uploaded with an older script sit loose in the date folder: after updating the script, the
library offers **Put each in its own folder** (also in each recording's Drive menu).

Sharing and Import need the newer Drive script: open **Connect Google Drive**, copy the code again,
paste it over the old one, save, then Deploy → Manage deployments → ✏️ → New version → Deploy.

## Notes
- The recording is buffered in memory until you stop (~1 GB/hour).
- If a recording is moved/deleted outside Chrome, it shows "File missing".
- Tell participants they are being recorded.
