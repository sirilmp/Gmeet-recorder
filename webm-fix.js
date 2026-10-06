// Chrome's MediaRecorder writes WebM as a live stream: no duration, no seek index (Cues) and
// "unknown" segment/cluster sizes. Players then show no time and can't seek.
// fixWebm() scans the file in windows (never loads it all into RAM) and returns a new Blob with
// Duration, a SeekHead, known sizes and Cues. The media data itself is reused, not copied.

const fixWebm = (() => {
const ID = {
  EBML: 0x1a45dfa3, Segment: 0x18538067, SeekHead: 0x114d9b74, Info: 0x1549a966, Tracks: 0x1654ae6b,
  Cluster: 0x1f43b675, Cues: 0x1c53bb6b, Void: 0xec, Timecode: 0xe7, SimpleBlock: 0xa3,
  TimecodeScale: 0x2ad7b1, Duration: 0x4489, TrackEntry: 0xae, TrackNumber: 0xd7, TrackType: 0x83,
};
const LEVEL1 = new Set([0x114d9b74, 0x1549a966, 0x1654ae6b, 0x1f43b675, 0x1c53bb6b, 0x1941a469, 0x1043a770, 0x1254c367]);

class Reader {
  constructor(file) {
    this.file = file;
    this.start = 0;
    this.buf = new Uint8Array(0);
  }
  // Make bytes [pos, pos+n) available; returns false at end of file
  async need(pos, n) {
    if (pos >= this.start && pos + n <= this.start + this.buf.length) return true;
    if (pos + n > this.file.size) return false;
    this.start = pos;
    const end = Math.min(this.file.size, pos + Math.max(n, 8 << 20));
    this.buf = new Uint8Array(await this.file.slice(pos, end).arrayBuffer());
    return true;
  }
  byte(pos) {
    return this.buf[pos - this.start];
  }
  bytes(pos, n) {
    return this.buf.slice(pos - this.start, pos - this.start + n);
  }
}

function vintLen(first) {
  for (let i = 0; i < 8; i++) if (first & (0x80 >> i)) return i + 1;
  throw new Error("bad vint");
}

// Element header at pos: {id, size (null = unknown), sizePos, sizeLen, data}
async function header(r, pos) {
  const n = Math.min(12, r.file.size - pos);
  if (n < 2 || !(await r.need(pos, n))) return null;
  const idLen = vintLen(r.byte(pos));
  let id = 0;
  for (let i = 0; i < idLen; i++) id = id * 256 + r.byte(pos + i);
  const sizePos = pos + idLen;
  const sizeLen = vintLen(r.byte(sizePos));
  let size = r.byte(sizePos) & (0xff >> sizeLen);
  let allOnes = size === 0xff >> sizeLen;
  for (let i = 1; i < sizeLen; i++) {
    const b = r.byte(sizePos + i);
    if (b !== 0xff) allOnes = false;
    size = size * 256 + b;
  }
  return { id, size: allOnes ? null : size, sizePos, sizeLen, data: sizePos + sizeLen };
}

const readUint = (bytes) => bytes.reduce((v, b) => v * 256 + b, 0);

// ---- writing
function idBytes(id) {
  const out = [];
  while (id > 0) {
    out.unshift(id & 0xff);
    id = Math.floor(id / 256);
  }
  return out;
}
function size8(n) {
  const out = [0x01];
  for (let i = 6; i >= 0; i--) out.push(Math.floor(n / 2 ** (8 * i)) & 0xff);
  return out;
}
function uint8(n) {
  const out = [];
  for (let i = 7; i >= 0; i--) out.push(Math.floor(n / 2 ** (8 * i)) & 0xff);
  return out;
}
const el = (id, payload) => [...idBytes(id), ...size8(payload.length), ...payload];

// Parse children of a small element held in memory
function children(bytes) {
  const out = [];
  let p = 0;
  while (p < bytes.length) {
    const idLen = vintLen(bytes[p]);
    const id = readUint(bytes.subarray(p, p + idLen));
    const sLen = vintLen(bytes[p + idLen]);
    let size = bytes[p + idLen] & (0xff >> sLen);
    for (let i = 1; i < sLen; i++) size = size * 256 + bytes[p + idLen + i];
    const data = p + idLen + sLen;
    out.push({ id, raw: bytes.subarray(p, data + size), value: bytes.subarray(data, data + size) });
    p = data + size;
  }
  return out;
}

async function fixWebm(file) {
  const r = new Reader(file);
  const ebml = await header(r, 0);
  if (!ebml || ebml.id !== ID.EBML) return file;
  await r.need(0, ebml.data + ebml.size);
  const ebmlBytes = r.bytes(0, ebml.data + ebml.size);

  const seg = await header(r, ebml.data + ebml.size);
  if (!seg || seg.id !== ID.Segment) return file;
  const segEnd = seg.size == null ? file.size : Math.min(file.size, seg.data + seg.size);

  let info = null;
  let tracks = null;
  const extras = [];
  const clusters = []; // {pos, sizePos, sizeLen, unknown, end}
  const cues = []; // {time, pos}
  let videoTrack = null;
  let firstTrack = null;
  let maxTime = 0;
  let bodyStart = null;
  let bodyEnd = null;

  let p = seg.data;
  while (p < segEnd) {
    const h = await header(r, p);
    if (!h) break;
    if (h.id === ID.Cluster) {
      if (bodyStart == null) bodyStart = p;
      const c = { pos: p, sizePos: h.sizePos, sizeLen: h.sizeLen, unknown: h.size == null };
      const limit = h.size == null ? segEnd : Math.min(segEnd, h.data + h.size);
      let q = h.data;
      let base = 0;
      let cued = false;
      while (q < limit) {
        const ch = await header(r, q);
        if (!ch || ch.size == null || (h.size == null && LEVEL1.has(ch.id))) break;
        const end = ch.data + ch.size;
        if (end > limit) break; // truncated last block
        if (ch.id === ID.Timecode) {
          await r.need(ch.data, ch.size);
          base = readUint(r.bytes(ch.data, ch.size));
        } else if (ch.id === ID.SimpleBlock && (await r.need(ch.data, 4))) {
          const tLen = vintLen(r.byte(ch.data));
          await r.need(ch.data, tLen + 3);
          const track = r.byte(ch.data) & (0xff >> tLen);
          let rel = (r.byte(ch.data + tLen) << 8) | r.byte(ch.data + tLen + 1);
          if (rel & 0x8000) rel -= 0x10000;
          const key = r.byte(ch.data + tLen + 2) & 0x80;
          const t = base + rel;
          if (t > maxTime) maxTime = t;
          const cueTrack = videoTrack ?? firstTrack;
          if (!cued && key && track === cueTrack) {
            cues.push({ time: Math.max(0, t), pos: p, track });
            cued = true;
          }
        }
        q = end;
      }
      c.end = q;
      clusters.push(c);
      bodyEnd = q;
      if (q < limit && h.size != null) break; // truncated
      p = h.size == null ? q : h.data + h.size;
      if (h.size == null && q < segEnd) {
        const next = await header(r, q);
        if (!next || !LEVEL1.has(next.id)) break; // garbage/truncated tail
      }
      continue;
    }
    if (h.size == null) break;
    if (bodyStart == null) {
      if (h.id === ID.Info || h.id === ID.Tracks) {
        await r.need(p, h.data + h.size - p);
        const raw = r.bytes(p, h.data + h.size - p);
        if (h.id === ID.Info) info = raw.subarray(h.data - p);
        else {
          tracks = raw;
          for (const te of children(raw.subarray(h.data - p))) {
            if (te.id !== ID.TrackEntry) continue;
            let num = null;
            let type = null;
            for (const f of children(te.value)) {
              if (f.id === ID.TrackNumber) num = readUint(f.value);
              if (f.id === ID.TrackType) type = readUint(f.value);
            }
            if (firstTrack == null) firstTrack = num;
            if (type === 1 && videoTrack == null) videoTrack = num;
          }
        }
      } else if (h.id !== ID.SeekHead && h.id !== ID.Void && h.id !== ID.Cues) {
        await r.need(p, h.data + h.size - p);
        extras.push(r.bytes(p, h.data + h.size - p));
      }
    }
    p = h.data + h.size;
  }
  if (!info || !tracks || !clusters.length) return file;

  // Info with Duration (in TimecodeScale units, ms by default)
  const infoKids = children(info).filter((c) => c.id !== ID.Duration);
  const dur = new DataView(new ArrayBuffer(8));
  dur.setFloat64(0, maxTime + 1);
  const infoEl = el(ID.Info, [
    ...infoKids.flatMap((c) => [...c.raw]),
    ...idBytes(ID.Duration), 0x88, ...new Uint8Array(dur.buffer),
  ]);

  const extrasLen = extras.reduce((n, x) => n + x.length, 0);
  const seek = (id, pos) => el(0x4dbb, [...el(0x53ab, idBytes(id)), ...el(0x53ac, uint8(pos))]);
  const seekLen = seek(ID.Info, 0).length * 3 + 12; // SeekHead id(4) + size(8)
  const headLen = seekLen + infoEl.length + tracks.length + extrasLen;
  const bodyLen = bodyEnd - bodyStart;
  const rel = (pos) => headLen + (pos - bodyStart); // position inside new segment data

  const seekHead = el(ID.SeekHead, [
    ...seek(ID.Info, seekLen),
    ...seek(ID.Tracks, seekLen + infoEl.length),
    ...seek(ID.Cues, headLen + bodyLen),
  ]);
  const cuesEl = el(
    ID.Cues,
    cues.flatMap((c) =>
      el(0xbb, [...el(0xb3, uint8(c.time)), ...el(0xb7, [...el(0xf7, uint8(c.track)), ...el(0xf1, uint8(rel(c.pos)))])])
    )
  );

  const segSize = headLen + bodyLen + cuesEl.length;
  const parts = [
    ebmlBytes,
    new Uint8Array([...idBytes(ID.Segment), ...size8(segSize)]),
    new Uint8Array(seekHead),
    new Uint8Array(infoEl),
    tracks,
    ...extras,
  ];
  // Media data: reuse the file slices, only patching unknown cluster sizes in place
  let cur = bodyStart;
  for (const c of clusters) {
    if (!c.unknown || c.sizeLen !== 8) continue;
    parts.push(file.slice(cur, c.sizePos), new Uint8Array(size8(c.end - (c.sizePos + 8))));
    cur = c.sizePos + 8;
  }
  parts.push(file.slice(cur, bodyEnd), new Uint8Array(cuesEl));
  return new Blob(parts, { type: "video/webm" });
}

  return fixWebm;
})();
