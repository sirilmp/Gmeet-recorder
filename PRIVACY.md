# Privacy Policy — Meet Recorder

**Last updated:** 2026-10-27

Meet Recorder is a Chrome extension that records Google Meet calls. This policy explains what
data it handles, where it goes, and what it does not do.

## Summary

- Recordings are saved **only on your own computer** unless you choose to upload them.
- Nothing is sent to the developer of this extension, ever. There is no backend server.
- The only third party involved is **your own Google account**, and only if you connect it.

## What the extension does

- Records the active Google Meet tab you choose to record: the tab's video (the meeting and,
  if you present, your shared screen), the audio of every participant, and optionally your
  microphone.
- Saves the finished recording to `Downloads/MeetRecordings` on your computer, and keeps a
  private copy inside the extension's own storage so you can upload it later without being
  asked to re-select the file.
- Can make a transcript of a recording. Speech-to-text runs **entirely on your computer**
  (an on-device Whisper model); the audio is never uploaded anywhere for this. The model's
  own weight files are downloaded once from Hugging Face on first use and cached locally —
  this is a one-time model download, not a transfer of your recordings or audio.
- Watches Google Meet's own on-page video tiles while recording, only to label transcript
  lines with the name of whoever is speaking. This reads what's already visible on the Meet
  page; it does not access any other website.

## What data is handled, and where it goes

| Data | Where it's handled | Leaves your device? |
|---|---|---|
| Recorded video/audio of your meetings | Saved to your Downloads folder and the extension's local storage | No, unless you upload it (see below) |
| Transcripts | Generated and stored on your device | No |
| Your settings (quality, auto-upload, etc.) | Chrome's local extension storage | No |
| Your Google account email (if you connect Drive) | Shown in the extension's own Settings page, to show which account is connected | Only to Google, via Google's own sign-in |

## Google Drive (optional)

If you choose to connect Google Drive, the extension asks Google for permission under the
**`drive.file`** scope — the most restrictive Drive scope Google offers. This means the
extension can only see and manage files **it creates itself** (the recordings, transcripts,
and notes it uploads for you). It cannot see, list, or modify any other file in your Drive.

Uploads go directly from your browser to your own Google Drive, through Google's own APIs
(and, if you've set one up, your own Google Apps Script deployment, which you control). The
developer of this extension never receives, stores, or has access to your recordings,
transcripts, or Drive contents.

You can disconnect Google Drive access at any time from
[your Google Account's connected apps page](https://myaccount.google.com/permissions).

## What this extension does not do

- It does not sell, rent, or share your data with any third party.
- It does not use your data for advertising, analytics, or any purpose other than the
  recording/transcription/upload features described above.
- It does not track your browsing history or activity on other websites.
- It does not transmit your recordings or transcripts to any server operated by the developer.

## Permissions

The permissions this extension requests (tab capture, offscreen documents, downloads, etc.)
are used only to implement the recording, transcription, and local-file features described
above. A full, permission-by-permission explanation is available in the extension's Chrome
Web Store listing.

## Changes to this policy

If this policy changes, the updated version will be posted at this same URL with a new
"Last updated" date.

## Contact

Questions about this policy or the extension's data practices: **sirilmp8@gmail.com**
