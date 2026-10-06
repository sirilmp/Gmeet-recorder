// Speaker names for transcript lines. While recording, content.js notes who Meet shows as talking
// and the recording keeps that as rec.speakers: [[ms from the start, name or null], ...], one entry
// each time it changes. A transcript line gets the name of whoever talked most during it.
// A line's name is kept in the line itself (sp), so the .txt / .vtt / Drive copies carry it, and a
// name changed by hand in the player stays.

// segs: [{s, e, t}] in seconds. Lines that already have a name (sp) keep it.
function labelSpeakers(segs, speakers) {
  if (!Array.isArray(segs) || !Array.isArray(speakers) || !speakers.length) return segs;
  return segs.map((x) => {
    if (x.sp !== undefined) return x;
    const sp = speakerAt(speakers, x.s * 1000, Math.max(x.e, x.s + 1) * 1000);
    return sp ? { ...x, sp } : x;
  });
}

// The name with the most talking time between from and to (ms); if nobody was seen talking then,
// whoever talked last within 1.5 s before (Meet's indicator lags behind short phrases).
function speakerAt(speakers, from, to) {
  const time = new Map();
  let last = null; // [name, end] of the last talking before the line
  for (let i = 0; i < speakers.length; i++) {
    const [at, name] = speakers[i];
    const end = i + 1 < speakers.length ? speakers[i + 1][0] : Infinity;
    if (end <= from) {
      if (name) last = [name, end];
      continue;
    }
    if (at >= to) break;
    if (!name) continue;
    const d = Math.min(end, to) - Math.max(at, from);
    if (d > 0) time.set(name, (time.get(name) || 0) + d);
  }
  let best = null;
  let most = 0;
  for (const [name, d] of time)
    if (d > most) {
      best = name;
      most = d;
    }
  return best || (last && from - last[1] < 1500 ? last[0] : null);
}

// "Sweta: hello" for the text copies (no name: just the text)
const speakerText = (x) => (x.sp ? `${x.sp}: ${x.t}` : x.t);

// A WebVTT cue's text with its speaker as a voice tag: "<v Sweta>hello"
const vttVoice = (x) => (x.sp ? `<v ${x.sp.replace(/[<>&\n]/g, "")}>${x.t}` : x.t);
