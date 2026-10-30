// Bijlagen uit de Canvas-zip: koppelen aan de verwijzingen in de EPUB en omzetten naar inhoud voor de syllabus.
import { stripEmoji } from './parse.js';

// pptx-preview is gesloten software met beperkingen op herpubliceren en staat daarom niet in vendor/: vaste versie via CDN, met hashcontrole.
const PPTX_LIB = 'https://cdn.jsdelivr.net/npm/pptx-preview@1.0.7/dist/pptx-preview.umd.js';
const PPTX_HASH = 'sha384-CwntHHT2FbwZXuCmbf6K93YaEB9xRVVLaqFJ7pdMykeQABb/3MA0sbt2lGbgi1Mr';
const PDF_LONG_SIDE = 1800; // px, ongeveer 200 dpi voor een slide op paginabreedte
const SLIDE_WIDTH = 650; // px, de tekstbreedte van een A4-pagina in print.css
const SLIDE_RATIO = 9 / 16;

const blobUrls = [];
const scripts = new Map();
let cache = new Map();

function loadScript(src, integrity) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = src;
      if (integrity) { sc.integrity = integrity; sc.crossOrigin = 'anonymous'; }
      sc.onload = resolve;
      sc.onerror = () => { scripts.delete(src); reject(new Error(src.split('/').pop() + ' kon niet geladen worden.')); };
      document.head.append(sc);
    }));
  }
  return scripts.get(src);
}

async function renderPdf(data) {
  const pdfjs = await import('../vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
  const doc = await pdfjs.getDocument({ data }).promise;
  const nodes = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: PDF_LONG_SIDE / Math.max(base.width, base.height) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    // intent 'print': zonder requestAnimationFrame, dus ook verder als het tabblad niet zichtbaar is.
    await page.render({ canvasContext: canvas.getContext('2d'), viewport, intent: 'print' }).promise;
    page.cleanup();
    const blob = await new Promise((r) => { canvas.toBlob(r, 'image/jpeg', 0.85); });
    const url = URL.createObjectURL(blob);
    blobUrls.push(url);
    const img = new Image(canvas.width, canvas.height);
    img.src = url;
    img.className = 'att-page';
    nodes.push(img);
  }
  await doc.destroy();
  return nodes;
}

async function renderDocx(data) {
  await loadScript('vendor/mammoth.browser.min.js');
  const { value } = await window.mammoth.convertToHtml({ arrayBuffer: data });
  const box = document.createElement('div');
  box.className = 'att-doc';
  box.innerHTML = value;
  return [box];
}

async function renderPptx(data) {
  await loadScript(PPTX_LIB, PPTX_HASH);
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-10000px;top:0;';
  document.body.append(host);
  try {
    const viewer = window.pptxPreview.init(host, { width: SLIDE_WIDTH, height: Math.round(SLIDE_WIDTH * SLIDE_RATIO), mode: 'list' });
    await viewer.preview(data);
    const slides = [...host.querySelectorAll('.pptx-preview-slide-wrapper')];
    // Grafieken zijn canvassen en die overleven het klonen door Paged.js niet.
    host.querySelectorAll('canvas').forEach((c) => {
      const img = new Image();
      img.src = c.toDataURL();
      img.style.cssText = c.style.cssText;
      c.replaceWith(img);
    });
    host.querySelectorAll('video,audio').forEach((m) => m.remove());
    slides.forEach((s) => { s.classList.add('att-slide'); s.style.margin = ''; });
    return slides;
  } finally {
    host.remove();
  }
}

const RENDERERS = { pdf: renderPdf, docx: renderDocx, pptx: renderPptx };

function decodeName(s) {
  const spaced = s.replace(/\+/g, ' ');
  try { return decodeURIComponent(spaced); } catch { return spaced; }
}

const matchKey = (name) => stripEmoji(name).normalize('NFC').toLowerCase();

export async function openZip(file) {
  const zip = await JSZip.loadAsync(file);
  const files = [];
  zip.forEach((path, entry) => {
    const ext = path.split('.').pop().toLowerCase();
    if (entry.dir || !RENDERERS[ext]) return;
    const parts = path.split('/');
    files.push({ path, ext, name: decodeName(parts.pop()), folder: parts.slice(1).map(decodeName).join('/') });
  });
  files.sort((a, b) => a.name.localeCompare(b.name, 'nl') || a.folder.localeCompare(b.folder, 'nl'));
  clearCache();
  return { name: file.name, files, entry: (path) => zip.file(path) };
}

// Canvas toont soms een andere naam dan het bestand in de zip (emoji ervoor): die vallen weg in de vergelijking.
// Wat dan nog niet overeenkomt, kiest de gebruiker zelf: liever geen bijlage dan de verkeerde.
export function linkAttachments(items, zip) {
  const paths = new Set(zip.files.map((f) => f.path));
  const byKey = new Map();
  zip.files.forEach((f) => { const k = matchKey(f.name); if (!byKey.has(k)) byKey.set(k, f); });
  for (const it of items) {
    for (const a of it.attachments) {
      if (paths.has(a.path)) continue; // eerder gekozen of bewaard
      a.path = byKey.get(matchKey(a.name))?.path || '';
      if (a.path && it.type === 'bestand') it.included = true;
    }
  }
}

function clearCache() {
  blobUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
  cache = new Map();
}

// Geeft telkens verse knopen terug: voorbeeld en export mogen elkaars DOM niet verplaatsen.
export async function renderAttachment(zip, path) {
  if (!cache.has(path)) {
    cache.set(path, zip.entry(path).async('arraybuffer').then((data) => RENDERERS[path.split('.').pop().toLowerCase()](data)));
  }
  return (await cache.get(path)).map((n) => n.cloneNode(true));
}
