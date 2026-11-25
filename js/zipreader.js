// Leest een zip zonder het hele bestand in het geheugen te laden: alleen de centrale map en de bestanden die nodig zijn.
// Canvas steekt video's in de EPUB, waardoor die makkelijk groter wordt dan de 2 GB die de browser in één keer kan lezen.
// Zelfde vorm als het deel van JSZip dat we gebruiken: file(path), forEach((path, entry) => …), entry.async(type).

const EOCD = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_EOCD = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX = 0xffffffff;

const utf8 = new TextDecoder('utf-8');

async function readView(file, start, length) {
  const buf = await file.slice(start, start + length).arrayBuffer();
  return new DataView(buf);
}

const u64 = (v, o) => Number(v.getBigUint64(o, true));

async function findEnd(file) {
  // Het eindrecord staat in de laatste 22 bytes, plus maximaal 64 kB commentaar.
  const tail = Math.min(file.size, 22 + 0xffff);
  const v = await readView(file, file.size - tail, tail);
  for (let i = tail - 22; i >= 0; i--) {
    if (v.getUint32(i, true) !== EOCD) continue;
    let count = v.getUint16(i + 10, true);
    let size = v.getUint32(i + 12, true);
    let offset = v.getUint32(i + 16, true);
    if ((count === 0xffff || size === MAX || offset === MAX) && i >= 20 && v.getUint32(i - 20, true) === ZIP64_LOCATOR) {
      const z = await readView(file, u64(v, i - 12), 56);
      if (z.getUint32(0, true) !== ZIP64_EOCD) throw new Error('Ongeldig zip64-bestand.');
      count = u64(z, 32);
      size = u64(z, 40);
      offset = u64(z, 48);
    }
    return { count, size, offset };
  }
  throw new Error('Geen geldig zip-bestand (einde van de inhoudstabel niet gevonden).');
}

async function inflate(blob) {
  const stream = blob.stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).arrayBuffer();
}

function makeEntry(file, info) {
  async function data() {
    if (info.flags & 1) throw new Error('Versleuteld bestand in zip: ' + info.name);
    const head = await readView(file, info.offset, 30);
    if (head.getUint32(0, true) !== LOCAL) throw new Error('Beschadigd bestand in zip: ' + info.name);
    const start = info.offset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
    const raw = file.slice(start, start + info.compressedSize);
    if (info.method === 0) return raw.arrayBuffer();
    if (info.method === 8) return inflate(raw);
    throw new Error(`Niet-ondersteunde compressie (${info.method}) voor ${info.name}`);
  }
  return {
    name: info.name,
    dir: info.dir,
    size: info.size,
    async async(type) {
      const buf = await data();
      if (type === 'string' || type === 'text') return utf8.decode(buf);
      if (type === 'uint8array') return new Uint8Array(buf);
      if (type === 'blob') return new Blob([buf]);
      return buf;
    },
  };
}

function parseExtra(v, start, length, info) {
  for (let p = start; p + 4 <= start + length;) {
    const id = v.getUint16(p, true);
    const len = v.getUint16(p + 2, true);
    let q = p + 4;
    if (id === 0x0001) { // zip64: alleen de velden die in het gewone record op 0xFFFFFFFF staan
      if (info.size === MAX) { info.size = u64(v, q); q += 8; }
      if (info.compressedSize === MAX) { info.compressedSize = u64(v, q); q += 8; }
      if (info.offset === MAX) info.offset = u64(v, q);
    } else if (id === 0x7075 && len > 5) { // Unicode-padnaam, zoals JSZip die ook gebruikt
      info.unicodeName = utf8.decode(new Uint8Array(v.buffer, v.byteOffset + p + 9, len - 5));
    }
    p += 4 + len;
  }
}

export async function openZipFile(file) {
  const end = await findEnd(file);
  const v = await readView(file, end.offset, end.size);
  const entries = new Map();
  let p = 0;
  for (let n = 0; n < end.count; n++) {
    if (v.getUint32(p, true) !== CENTRAL) throw new Error('Beschadigde inhoudstabel in zip.');
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const info = {
      flags: v.getUint16(p + 8, true),
      method: v.getUint16(p + 10, true),
      compressedSize: v.getUint32(p + 20, true),
      size: v.getUint32(p + 24, true),
      offset: v.getUint32(p + 42, true),
      name: utf8.decode(new Uint8Array(v.buffer, v.byteOffset + p + 46, nameLen)),
    };
    parseExtra(v, p + 46 + nameLen, extraLen, info);
    if (info.unicodeName) info.name = info.unicodeName;
    info.dir = info.name.endsWith('/');
    entries.set(info.name, makeEntry(file, info));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    file: (path) => entries.get(path) || null,
    forEach: (fn) => entries.forEach((entry, path) => fn(path, entry)),
  };
}
