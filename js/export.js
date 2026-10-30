// Bouwt het syllabus-document uit de selectie en pagineert het met Paged.js voor Opslaan-als-PDF.
import { state } from './state.js';
import { stripEmoji } from './parse.js';
import { renderAttachment } from './attachments.js';

const escapeCss = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');

export function displayTitle(title) {
  return state.settings.stripEmoji ? stripEmoji(title) || title : title;
}

function shiftHeadings(root) {
  const heads = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')];
  for (const h of heads) {
    const level = Math.min(Number(h.tagName[1]) + 2, 6);
    const n = document.createElement('h' + level);
    for (const a of h.attributes) n.setAttribute(a.name, a.value);
    n.append(...h.childNodes);
    h.replaceWith(n);
  }
}

function fixLinks(root, targets) {
  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (/^(https?:|mailto:|tel:)/i.test(href)) continue;
    const [path, frag = ''] = href.split('#');
    let f = frag;
    try { f = decodeURIComponent(frag); } catch { /* laat staan */ }
    let target = null;
    if (f && targets.anchors.has(f)) target = targets.anchors.get(f);
    else if (f && targets.ids.has(f)) target = f;
    else if (!f && path) target = targets.files.get(path.split('/').pop().replace(/\.x?html?$/i, ''));
    if (target) a.setAttribute('href', '#' + target);
    else a.replaceWith(...a.childNodes);
  }
}

export function buildSyllabus() {
  const s = state.settings;
  const mods = state.modules.map((m) => ({ ...m, picked: m.items.filter((i) => i.included) })).filter((m) => m.picked.length);

  const targets = { anchors: new Map(), files: new Map(), ids: new Set() };
  mods.forEach((m, mi) => {
    targets.anchors.set(m.anchor, `mod-${mi}`);
    targets.files.set(m.id, `mod-${mi}`);
    m.picked.forEach((it, ii) => targets.anchors.set(it.anchor, `sec-${mi}-${ii}`));
  });

  const root = document.createElement('div');
  root.className = 'syl' + (s.showDetails ? ' show-details' : '') + (s.chapterPageBreak ? '' : ' flow') + (s.itemPageBreak ? ' item-pages' : '');

  if (s.cover) {
    const c = document.createElement('section');
    c.className = 'cover';
    if (s.logo) { const img = new Image(); img.src = s.logo; img.className = 'cover-logo'; c.append(img); }
    const h = document.createElement('h1');
    h.className = 'cover-title';
    h.textContent = s.title || state.course.title;
    c.append(h);
    for (const [cls, txt] of [['cover-sub', s.subtitle], ['cover-year', s.year], ['cover-author', s.author]]) {
      if (!txt) continue;
      const p = document.createElement('p');
      p.className = cls;
      p.textContent = txt;
      c.append(p);
    }
    root.append(c);
  }

  if (s.toc) {
    const nav = document.createElement('nav');
    nav.className = 'toc';
    nav.innerHTML = '<h1 class="toc-title">Inhoudsopgave</h1>';
    const ol = document.createElement('ol');
    mods.forEach((m, mi) => {
      const li = document.createElement('li');
      li.className = 'toc-module';
      li.innerHTML = `<a href="#mod-${mi}"></a>`;
      li.firstChild.textContent = displayTitle(m.title);
      ol.append(li);
      if (s.tocItems) {
        m.picked.forEach((it, ii) => {
          const l2 = document.createElement('li');
          l2.className = 'toc-item';
          l2.innerHTML = `<a href="#sec-${mi}-${ii}"></a>`;
          l2.firstChild.textContent = displayTitle(it.title);
          ol.append(l2);
        });
      }
    });
    nav.append(ol);
    root.append(nav);
  }

  const bodies = [];
  mods.forEach((m, mi) => {
    const sec = document.createElement('section');
    sec.className = 'chapter';
    sec.id = `mod-${mi}`;
    const h1 = document.createElement('h1');
    h1.className = 'module-title';
    h1.textContent = displayTitle(m.title);
    sec.append(h1);
    m.picked.forEach((it, ii) => {
      const item = document.createElement('section');
      item.className = 'topic';
      item.id = `sec-${mi}-${ii}`;
      const h2 = document.createElement('h2');
      h2.className = 'item-title';
      h2.textContent = displayTitle(it.title);
      const body = document.createElement('div');
      body.className = 'item-body';
      body.innerHTML = it.html;
      shiftHeadings(body);
      body.querySelectorAll('.file-ref').forEach((ref) => {
        const a = it.attachments[ref.dataset.att];
        if (state.zip && a.included && a.path) { ref.dataset.attPath = a.path; ref.dataset.attName = a.name; }
      });
      body.querySelectorAll('[id]').forEach((e) => targets.ids.add(e.id));
      bodies.push(body);
      item.append(h2, body);
      sec.append(item);
    });
    root.append(sec);
  });
  bodies.forEach((b) => fixLinks(b, targets));
  return { root, modules: mods.length, items: mods.reduce((n, m) => n + m.picked.length, 0) };
}

// Een bijlage komt onder de buitenste alinea, lijst of tabel waarin de verwijzing staat, niet in een li of cel.
function blockOf(ref) {
  let block = ref;
  for (let p = ref.parentElement; p && !p.classList.contains('item-body'); p = p.parentElement) {
    if (p.matches('p,ul,ol,table')) block = p;
  }
  while (block.nextElementSibling?.classList.contains('attachment')) block = block.nextElementSibling;
  return block;
}

async function addAttachments(root, onStatus) {
  const refs = [...root.querySelectorAll('[data-att-path]')];
  const failed = [];
  for (const [i, ref] of refs.entries()) {
    onStatus(`Bijlage ${i + 1} van ${refs.length} omzetten…`);
    const box = document.createElement('div');
    box.className = 'attachment';
    try {
      box.append(...await renderAttachment(state.zip, ref.dataset.attPath));
      shiftHeadings(box);
    } catch (err) {
      console.error(ref.dataset.attPath, err);
      const name = ref.dataset.attPath.split('/').pop();
      failed.push(name);
      box.innerHTML = '<p class="missing-image"></p>';
      box.firstChild.textContent = `[bijlage kon niet omgezet worden: ${name}]`;
    }
    // Een bestand-item met meerdere bestanden heeft geen tekst ertussen: zonder naam zijn de bijlagen niet uit elkaar te houden.
    if (!ref.textContent && ref.parentElement.querySelectorAll('.file-ref').length > 1) {
      const name = document.createElement('p');
      name.className = 'att-name';
      name.textContent = ref.dataset.attName;
      box.prepend(name);
    }
    blockOf(ref).after(box);
  }
  return failed;
}

function dynamicCss() {
  const s = state.settings;
  const name = escapeCss(s.title || state.course.title);
  let css = `@page { @bottom-left { content: "${name}"; } }\n`;
  if (!s.pageNumbers) css += '@page { @bottom-right { content: none; } }\n';
  if (!s.chapterPageBreak) css += 'section.chapter { break-before: auto; }\n';
  if (s.itemPageBreak) css += 'section.topic:not(:first-of-type) { break-before: page; }\n';
  if (s.showDetails) css += '.pagedjs_page_content .item_details { display: block; border: 1px solid #c6c6c6; background: #f2f2f2; padding: 0 0.8em; font-size: 9pt; margin: 0.6em 0; }\n';
  return css;
}

// content.css is voor de app geschreven met .syl; in de gepagineerde weergave bestaat die wrapper niet.
async function contentCss() {
  const css = await (await fetch('css/content.css')).text();
  return css.replace(/\.syl\.[\w-]+[^{]*\{[^}]*\}/g, '').replace(/\.syl\b/g, '.pagedjs_page_content');
}

function loadPaged() {
  if (window.Paged) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = 'vendor/paged.polyfill.js';
    sc.onload = resolve;
    sc.onerror = () => reject(new Error('Paged.js kon niet geladen worden.'));
    document.head.append(sc);
  });
}

export function clearPaged(pagesEl) {
  pagesEl.innerHTML = '';
  document.querySelectorAll('style[data-pagedjs-inserted-styles]').forEach((n) => n.remove());
}

// Rendert de gepagineerde syllabus in pagesEl. Geeft { pages, ms, failed } terug.
export async function renderPaged(pagesEl, onStatus) {
  clearPaged(pagesEl);
  const { root, items } = buildSyllabus();
  if (!items) throw new Error('Er zijn geen items geselecteerd.');
  const failed = await addAttachments(root, onStatus);
  onStatus('Afbeeldingen laden…');
  // Paged.js meet de hoogte tijdens het opmaken: alle afbeeldingen moeten eerst geladen zijn.
  await Promise.all([...root.querySelectorAll('img')].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))));
  onStatus('Paged.js laden…');
  await loadPaged();
  const previewer = new window.Paged.Previewer();
  let n = 0;
  previewer.on('page', () => { n++; if (n % 5 === 0 || n < 5) onStatus(`Pagina’s opmaken… (${n})`); });
  const flow = await previewer.preview(root, [{ 'content.css': await contentCss() }, 'css/print.css', { 'dynamic.css': dynamicCss() }], pagesEl);
  return { pages: flow.total ?? n, ms: Math.round(flow.performance), failed };
}
