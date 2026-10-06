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

## Google Drive setup (one time)
1. Google Cloud Console → new project → enable **Google Drive API**.
2. OAuth consent screen → add yourself as a test user.
3. Credentials → **OAuth client ID** → type **Chrome extension**, item ID = this extension's ID.
4. Put it in `manifest.json` → `oauth2.client_id`, then reload the extension.
Scope is `drive.file` (only files this extension creates).

## Notes
- The recording is buffered in memory until you stop (~1 GB/hour).
- If a recording is moved/deleted outside Chrome, it shows "File missing".
- Tell participants they are being recorded.
