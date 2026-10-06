// Reads a recording's sound a couple of minutes at a time, so a long meeting is never decoded (or
// even read) in one go. The recorder writes fragmented MP4 (moof+mdat pairs) or WebM (clusters);
// the file's header plus a run of fragments/clusters is itself a small valid file, which the
// browser's audio decoder reads like any other. Timestamps are rebased to 0 in each piece, and the
// piece's real start time is returned with it, so pieces line up exactly on the meeting's timeline.

const AudioPieces = (() => {
const RATE = 16000; // what Whisper wants
const PIECE_SEC = 120;
const PIECE_BYTES = 48 << 20;
const WHOLE_FILE_MAX = 256 << 20; // files we can't split are decoded whole only up to this size

const read = async (file, pos, n) => new Uint8Array(await file.slice(pos, Math.min(file.size, pos + n)).arrayBuffer());
const view = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const fourcc = (b, i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);

// ---------- MP4 ----------

// Child boxes in b[from, to): [{type, start, end, body}]
function boxes(b, from, to) {
  const out = [];
  let p = from;
  while (p + 8 <= to) {
    let size = view(b).getUint32(p);
    let hdr = 8;
    if (size === 1) {
      size = Number(view(b).getBigUint64(p + 8));
      hdr = 16;
    } else if (size === 0) size = to - p;
    if (size < hdr || p + size > to) break;
    out.push({ type: fourcc(b, p + 4), start: p, end: p + size, body: p + hdr });
    p += size;
  }
  return out;
}
const child = (b, box, type) => boxes(b, box.body, box.end).find((x) => x.type === type);

// Track id -> {timescale, sound} from the moov box
function mp4Tracks(b, moov) {
  const tracks = new Map();
  for (const trak of boxes(b, moov.body, moov.end).filter((x) => x.type === "trak")) {
    const tkhd = child(b, trak, "tkhd");
    const mdia = child(b, trak, "mdia");
    const mdhd = mdia && child(b, mdia, "mdhd");
    const hdlr = mdia && child(b, mdia, "hdlr");
    if (!tkhd || !mdhd || !hdlr) continue;
    const id = view(b).getUint32(tkhd.body + (b[tkhd.body] === 1 ? 20 : 12));
    const timescale = view(b).getUint32(mdhd.body + (b[mdhd.body] === 1 ? 20 : 12));
    tracks.set(id, { timescale, sound: fourcc(b, hdlr.body + 8) === "soun" });
  }
  return tracks;
}

async function mp4Plan(file) {
  const units = [];
  let init = null;
  let tracks = null;
  let audioId = null;
  let pos = 0;
  while (pos + 8 <= file.size) {
    const h = await read(file, pos, 16);
    let size = view(h).getUint32(0);
    const type = fourcc(h, 4);
    if (size === 1) size = Number(view(h).getBigUint64(8));
    else if (size === 0) size = file.size - pos;
    if (size < 8) break;
    const end = Math.min(file.size, pos + size); // the last box of a cut-short recording can be truncated
    if (type === "moov") {
      const b = await read(file, pos, end - pos);
      tracks = mp4Tracks(b, boxes(b, 0, b.length)[0]);
      for (const [id, t] of tracks) if (t.sound && audioId == null) audioId = id;
      if (audioId == null) throw new Error("This recording has no sound.");
      init = await read(file, 0, end); // ftyp + moov
    } else if (type === "moof") {
      if (!init) throw new Error("not a fragmented MP4");
      const b = await read(file, pos, Math.min(end - pos, 4 << 20));
      const moof = boxes(b, 0, b.length)[0];
      const times = []; // per track: where its decode time sits in the moof, and its value
      for (const traf of moof ? boxes(b, moof.body, moof.end).filter((x) => x.type === "traf") : []) {
        const tfhd = child(b, traf, "tfhd");
        const tfdt = child(b, traf, "tfdt");
        if (!tfhd || !tfdt) continue;
        const v1 = b[tfdt.body] === 1;
        const value = v1 ? Number(view(b).getBigUint64(tfdt.body + 4)) : view(b).getUint32(tfdt.body + 4);
        times.push({ track: view(b).getUint32(tfhd.body + 4), at: tfdt.body + 4, v1, value });
      }
      const a = times.find((x) => x.track === audioId) || times[0];
      const tr = a && tracks.get(a.track);
      const t = tr && tr.timescale ? a.value / tr.timescale : units.length ? units[units.length - 1].t : 0;
      units.push({ start: pos, end, t, times });
    } else if (type === "mdat") {
      if (units.length) units[units.length - 1].end = end;
    } else if (type === "mfra") break;
    pos += size;
  }
  if (!init || !units.length) throw new Error("not a fragmented MP4");

  // Make each piece start at time 0 (per track), so the decoder never pads it with the time before it
  const rebase = (bytes, list) => {
    const first = new Map();
    let off = init.length;
    for (const u of list) {
      for (const x of u.times) {
        if (!first.has(x.track)) first.set(x.track, x.value);
        const v = x.value - first.get(x.track);
        if (x.v1) view(bytes).setBigUint64(off + x.at, BigInt(v));
        else view(bytes).setUint32(off + x.at, v);
      }
      off += u.end - u.start;
    }
  };
  return { init, units, rebase };
}

// ---------- WebM ----------

const ID = { EBML: 0x1a45dfa3, Segment: 0x18538067, Info: 0x1549a966, Tracks: 0x1654ae6b, Cluster: 0x1f43b675, Timecode: 0xe7, TimecodeScale: 0x2ad7b1 };
const LEVEL1 = new Set([0x114d9b74, 0x1549a966, 0x1654ae6b, 0x1f43b675, 0x1c53bb6b, 0x1941a469, 0x1043a770, 0x1254c367]);

// Element header at b[i]: {id, size (null = unknown), data (index of its first data byte)}
function ebml(b, i) {
  if (i >= b.length) return null;
  let n = 1;
  while (n <= 4 && !(b[i] & (0x80 >> (n - 1)))) n++;
  if (n > 4 || i + n >= b.length) return null;
  let id = 0;
  for (let k = 0; k < n; k++) id = id * 256 + b[i + k];
  const s = i + n;
  let len = 1;
  while (len <= 8 && !(b[s] & (0x80 >> (len - 1)))) len++;
  if (len > 8 || s + len > b.length) return null;
  let size = b[s] & (0xff >> len);
  let ones = size === 0xff >> len;
  for (let k = 1; k < len; k++) {
    if (b[s + k] !== 0xff) ones = false;
    size = size * 256 + b[s + k];
  }
  return { id, size: ones ? null : size, data: s + len };
}
const uint = (b, i, n) => {
  let v = 0;
  for (let k = 0; k < n; k++) v = v * 256 + b[i + k];
  return v;
};

async function webmPlan(file) {
  const head = async (pos) => ebml(await read(file, pos, 16), 0);
  const top = await head(0);
  if (!top || top.id !== ID.EBML || top.size == null) throw new Error("not a WebM file");
  const seg = await head(top.data + top.size);
  if (!seg || seg.id !== ID.Segment) throw new Error("not a WebM file");
  const segStart = top.data + top.size;
  const segData = segStart + seg.data;
  const segEnd = seg.size == null ? file.size : Math.min(file.size, segData + seg.size);
  const parts = [await read(file, 0, segStart), new Uint8Array([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])];
  let scale = 1e6; // ns per timecode tick
  const units = [];
  let pos = segData;
  while (pos < segEnd) {
    const h = await head(pos);
    if (!h) break;
    const data = pos + h.data;
    if (h.id === ID.Cluster) {
      const b = await read(file, pos, h.data + 16);
      const tc = ebml(b, h.data);
      let end;
      if (h.size != null) end = Math.min(segEnd, data + h.size);
      else {
        // live-written cluster: walk its blocks until the next top-level element
        end = data;
        for (;;) {
          const c = await head(end);
          if (!c || LEVEL1.has(c.id) || c.size == null) break;
          end = Math.min(segEnd, end + c.data + c.size);
          if (end >= segEnd) break;
        }
      }
      const t = tc && tc.id === ID.Timecode ? { at: tc.data, len: tc.size, value: uint(b, tc.data, tc.size) } : null;
      units.push({ start: pos, end, t: t ? (t.value * scale) / 1e9 : units.length ? units[units.length - 1].t : 0, tc: t });
      pos = end;
      continue;
    }
    if (h.size == null) break;
    if (h.id === ID.Info || h.id === ID.Tracks) {
      const b = await read(file, pos, h.data + h.size);
      parts.push(b);
      if (h.id === ID.Info) {
        for (let i = h.data; i < b.length; ) {
          const c = ebml(b, i);
          if (!c || c.size == null) break;
          if (c.id === ID.TimecodeScale) scale = uint(b, c.data, c.size);
          i = c.data + c.size;
        }
      }
    }
    pos = data + h.size;
  }
  if (!units.length) throw new Error("not a WebM file");
  const init = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((o, p) => (init.set(p, o), o + p.length), 0);

  const rebase = (bytes, list) => {
    let base = null;
    let off = init.length;
    for (const u of list) {
      if (u.tc) {
        if (base == null) base = u.tc.value;
        let v = u.tc.value - base;
        for (let k = u.tc.len - 1; k >= 0; k--, v = Math.floor(v / 256)) bytes[off + u.tc.at + k] = v & 0xff;
      }
      off += u.end - u.start;
    }
  };
  return { init, units, rebase };
}

// ---------- decoding ----------

async function decodeMono(bytes) {
  const ctx = new OfflineAudioContext(1, 1, RATE); // decodes and resamples, no sound device needed
  const buf = await ctx.decodeAudioData(bytes.buffer);
  const n = buf.numberOfChannels;
  const out = new Float32Array(buf.length);
  for (let c = 0; c < n; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) out[i] += d[i] / n;
  }
  return out;
}

// Yields {t (seconds into the recording), pcm (mono 16 kHz Float32Array)}, starting with the
// piece that holds `fromSec`.
async function* pieces(file, ext, fromSec = 0) {
  let plan;
  try {
    plan = ext === "mp4" ? await mp4Plan(file) : await webmPlan(file);
  } catch (e) {
    if (/no sound/.test(e.message)) throw e;
    // Not laid out the way the recorder writes it: read it whole, if that is safe
    if (file.size > WHOLE_FILE_MAX) throw new Error("This file can't be read in parts, and it is too big to read at once.");
    yield { t: 0, pcm: await decodeMono(await read(file, 0, file.size)) };
    return;
  }
  const { init, units, rebase } = plan;
  let i = 0;
  while (i + 1 < units.length && units[i + 1].t <= fromSec) i++;
  let decoded = 0;
  let failed = 0;
  while (i < units.length) {
    let j = i + 1;
    while (j < units.length && units[j].t - units[i].t < PIECE_SEC && units[j].end - units[i].start < PIECE_BYTES) j++;
    const list = units.slice(i, j);
    const start = list[0].start;
    const end = list[list.length - 1].end;
    const bytes = new Uint8Array(init.length + (end - start));
    bytes.set(init);
    bytes.set(await read(file, start, end - start), init.length);
    rebase(bytes, list);
    let pcm = null;
    try {
      pcm = await decodeMono(bytes);
      decoded++;
    } catch (e) {
      // a damaged piece (e.g. the cut-off end of a crashed recording) is skipped, not fatal
      console.warn("audio piece skipped at", list[0].t, e);
      failed++;
      if (!decoded && failed >= 3) throw new Error("The sound in this recording can't be decoded.");
    }
    if (pcm) yield { t: list[0].t, pcm };
    i = j;
  }
  if (!decoded) throw new Error("The sound in this recording can't be decoded.");
}

return { RATE, pieces };
})();
