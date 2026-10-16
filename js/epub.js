// Leest een Canvas-EPUB (zip) en zet hem om naar een lijst modules met items.
import { parseDocument } from './parse.js';

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' };
const norm = (p) => p.normalize('NFC').toLowerCase();

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

function resolvePath(fromFile, href) {
  const clean = safeDecode(href.split('#')[0].split('?')[0]);
  const parts = fromFile.split('/').slice(0, -1);
  for (const seg of clean.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

export async function loadEpub(file, onProgress = () => {}) {
  const zip = await JSZip.loadAsync(file);
  const readText = async (path) => {
    const f = zip.file(path);
    if (!f) throw new Error('Bestand ontbreekt in EPUB: ' + path);
    return f.async('string');
  };
  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');

  const container = xml(await readText('META-INF/container.xml'));
  const opfPath = container.getElementsByTagName('rootfile')[0].getAttribute('full-path');
  const opf = xml(await readText(opfPath));
  const baseDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const meta = (name) => opf.getElementsByTagName(name)[0]?.textContent.trim() || '';

  const manifest = new Map();
  for (const it of opf.getElementsByTagName('item')) {
    manifest.set(it.getAttribute('id'), { href: it.getAttribute('href'), props: it.getAttribute('properties') || '', type: it.getAttribute('media-type') || '' });
  }
  const spine = [...opf.getElementsByTagName('itemref')].map((r) => manifest.get(r.getAttribute('idref'))).filter(Boolean);

  const mediaIndex = new Map();
  zip.forEach((rel, entry) => { if (!entry.dir) mediaIndex.set(norm(rel), entry); });

  const blobUrls = new Map();
  const stats = { images: 0, missingImages: 0 };
  async function resolveMedia(fromFile, src) {
    const path = resolvePath(fromFile, src);
    const key = norm(path);
    if (blobUrls.has(key)) return blobUrls.get(key);
    const entry = mediaIndex.get(key);
    if (!entry) return null;
    const ext = path.split('.').pop().toLowerCase();
    const blob = new Blob([await entry.async('arraybuffer')], { type: MIME[ext] || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    blobUrls.set(key, url);
    return url;
  }

  const docs = spine.filter((s) => s.type.includes('html') && !s.props.includes('nav') && !/(^|\/)toc\.xhtml$/.test(s.href));
  const modules = [];
  for (let i = 0; i < docs.length; i++) {
    const path = baseDir + safeDecode(docs[i].href);
    onProgress(`Hoofdstuk ${i + 1} van ${docs.length} verwerken…`, i / docs.length);
    const mod = await parseDocument(await readText(path), {
      file: path,
      resolveMedia: (src) => resolveMedia(path, src),
      stats,
    });
    if (mod) modules.push(mod);
  }
  // Syllabus en aankondigingen (Canvas-extra's) achteraan en standaard uitgevinkt.
  const isExtra = (m) => /(^|\/)(syllabus|announcements)\.xhtml$/.test(m.file);
  modules.sort((a, b) => isExtra(a) - isExtra(b));
  modules.forEach((m) => { if (isExtra(m)) m.items.forEach((it) => { it.included = false; }); });

  return {
    id: meta('dc:identifier') || file.name,
    title: meta('dc:title') || file.name.replace(/\.epub$/i, ''),
    language: meta('dc:language') || 'nl',
    modules,
    stats,
    dispose: () => blobUrls.forEach((u) => URL.revokeObjectURL(u)),
  };
}
