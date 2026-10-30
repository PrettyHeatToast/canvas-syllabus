// Zet één Canvas-xhtml (één module) om naar { id, title, items[] }.
const EMOJI_START = /^\s*(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*)/u;
const SELF_CLOSING = /<(div|p|span|a|td|th|tr|table|strong|em|b|i|u|h[1-6]|li|ul|ol|section|iframe|script|style)(\s[^<>]*?)?\/>/gi;
const EMBEDS = 'iframe,video,audio,embed,object';

const collapse = (s) => s.replace(/\s+/g, ' ').trim();

function parseXhtml(src) {
  let doc = new DOMParser().parseFromString(src, 'application/xhtml+xml');
  if (doc.querySelector('parsererror')) {
    doc = new DOMParser().parseFromString(src.replace(SELF_CLOSING, '<$1$2></$1>'), 'text/html');
  }
  return doc;
}

const FILE_EXT = /\.(pdf|docx?|pptx?|xlsx?|zip|csv|txt|mp[34]|mov|png|jpe?g|gif)\s*$/i;
const FILE_NOTE = /^Bestand .+ kon niet ingevoerd worden in het ePub/i;
const FILE_NOTE_INLINE = /Bestand\s+(.+?)\s+kon niet ingevoerd worden in het ePub document\.?\s*(?:Zie apart zip-bestand voor toegang\.?)?/gi;
const QUIZ_HINT = /quiz|toets|tijdslimiet|time limit|aantal vragen|questions/i;

// Type uit de structuur van het Canvas-item (niet uit de emoji):
// bestand = enkel de "kon niet ingevoerd worden"-melding of titel met bestandsextensie,
// opdracht/toets = item met een Canvas-details-blok (Beoordelingstype, Punten, …), toets bij quiz-woorden daarin.
function itemType(title, text, box) {
  if (FILE_NOTE.test(text) || (FILE_EXT.test(title) && text.length < 200)) return 'bestand';
  const details = box.querySelector('.item_details');
  if (details) return QUIZ_HINT.test(details.textContent) ? 'toets' : 'opdracht';
  return 'pagina';
}

export function leadingEmoji(title) {
  return (title.match(EMOJI_START) || [])[1] || '';
}

export function stripEmoji(title) {
  return collapse(title.replace(/[\p{Extended_Pictographic}️‍\p{Emoji_Modifier}]/gu, ''));
}

const isPageBreak = (el) => el.tagName === 'DIV' && /page-break/.test(el.getAttribute('style') || '') && !el.textContent.trim() && !el.children.length;
const isBackLink = (el) => el.tagName === 'P' && /^terug naar/i.test(collapse(el.textContent)) && el.querySelectorAll('a').length >= 1 && el.children.length === el.querySelectorAll('a').length;

// De EPUB bevat de bestanden zelf niet: elke melding wordt een .file-ref met enkel de bestandsnaam, de plek waar de bijlage uit de zip komt.
function markAttachments(container, attachments) {
  const walker = container.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const notes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeValue.search(FILE_NOTE_INLINE) >= 0) notes.push(n);
  }
  for (const n of notes) {
    const parts = [];
    let last = 0;
    for (const m of n.nodeValue.matchAll(FILE_NOTE_INLINE)) {
      const ref = container.ownerDocument.createElement('span');
      ref.className = 'file-ref';
      ref.dataset.att = attachments.length;
      ref.textContent = m[1];
      attachments.push({ name: m[1], kind: leadingEmoji(m[1]), path: '', included: true });
      parts.push(n.nodeValue.slice(last, m.index), ref);
      last = m.index + m[0].length;
    }
    n.replaceWith(...parts, n.nodeValue.slice(last));
  }
}

async function clean(container, { resolveMedia, stats, attachments }) {
  container.querySelectorAll('script,style,link,meta').forEach((n) => n.remove());
  markAttachments(container, attachments);
  [...container.children].filter(isPageBreak).forEach((n) => n.remove());

  // "Terug naar …"-navigatie van Canvas weghalen (samen met de hr ervoor).
  container.querySelectorAll('p').forEach((p) => {
    if (!isBackLink(p)) return;
    const prev = p.previousElementSibling;
    if (prev && prev.tagName === 'HR') prev.remove();
    p.remove();
  });

  for (const el of container.querySelectorAll(EMBEDS)) {
    const src = el.getAttribute('src') || el.querySelector('source')?.getAttribute('src') || '';
    const note = container.ownerDocument.createElement('p');
    note.className = 'embed-note';
    note.append('Ingesloten inhoud (niet beschikbaar in PDF)');
    if (/^https?:/i.test(src)) {
      const a = container.ownerDocument.createElement('a');
      a.href = src;
      a.textContent = src;
      note.append(': ', a);
    }
    el.replaceWith(note);
  }

  for (const el of container.querySelectorAll('*')) {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name) || a.name === 'loading' || a.name.startsWith('data-api-')) el.removeAttribute(a.name);
    }
  }

  // Canvas-editor gebruikt soms één gigantisch <li> als inspringing; zo'n lijst is niet te pagineren (Paged.js loopt vast).
  for (let again = true; again;) {
    again = false;
    for (const list of container.querySelectorAll('ul,ol')) {
      const kids = [...list.children];
      if (kids.length === 1 && kids[0].tagName === 'LI' && kids[0].textContent.length > 300) {
        const div = container.ownerDocument.createElement('div');
        div.append(...kids[0].childNodes);
        list.replaceWith(div);
        again = true;
        break;
      }
    }
  }

  // De Canvas-editor gebruikt soms een lijst met één enorm li-item als inspringing rond hele stukken tekst.
  // Zulke reuzen-li's laten Paged.js vastlopen: de lijst ontpakken (binnenste eerst).
  [...container.querySelectorAll('ul,ol')].reverse().forEach((list) => {
    const lis = [...list.children].filter((c) => c.tagName === 'LI');
    if (lis.length !== 1 || list.children.length !== 1) return;
    if (lis[0].querySelectorAll(':scope > p, :scope > ul, :scope > ol, :scope > table').length < 2) return;
    list.replaceWith(...lis[0].childNodes);
  });

  // Een <b>/<strong> die hele blokken omsluit (p, lijst, tabel, kop, …) is een editor-artefact (bv. een niet gesloten
  // tag of een Google-Docs-wrapper) en maakt alles erin vet; in Canvas zelf ziet de cursus er niet zo uit. Ontpakken, binnenste eerst.
  [...container.querySelectorAll('b,strong')].reverse().forEach((bold) => {
    if (bold.querySelector('p,ul,ol,table,div,h1,h2,h3,h4,h5,h6,blockquote,pre,hr')) bold.replaceWith(...bold.childNodes);
  });

  const imgs = [...container.querySelectorAll('img')];
  await Promise.all(imgs.map(async (img) => {
    stats.images++;
    const src = img.getAttribute('src') || '';
    // Canvas-bestandslinks (login nodig) en http-afbeeldingen die niet in de EPUB zitten, werken niet in een PDF.
    const remote = /^https?:/i.test(src);
    if (/^(data:|blob:)/i.test(src) || (remote && !/instructure\.com/i.test(src))) return;
    const url = src && !remote ? await resolveMedia(src) : null;
    if (url) {
      img.setAttribute('src', url);
    } else {
      stats.missingImages++;
      const span = container.ownerDocument.createElement('span');
      span.className = 'missing-image';
      span.textContent = img.getAttribute('alt') ? `[afbeelding: ${img.getAttribute('alt')}]` : '[afbeelding ontbreekt]';
      img.replaceWith(span);
    }
  }));
}

export async function parseDocument(src, { file, resolveMedia, stats }) {
  const doc = parseXhtml(src);
  const body = doc.querySelector('body');
  if (!body) return null;
  const fileKey = file.split('/').pop().replace(/\.x?html?$/i, '');
  const h1 = body.querySelector('h1');
  const moduleTitle = collapse(h1?.textContent || doc.querySelector('title')?.textContent || fileKey);
  const moduleId = h1?.getAttribute('id') || fileKey;

  // Items staan in het mini-inhoudsopgave-lijstje (#id) bovenaan en beginnen met een h2 met dat id.
  const tocIds = new Set([...body.querySelectorAll(':scope > ol a[href^="#"]')].map((a) => a.getAttribute('href').slice(1)));
  const isItemStart = (el) => /^H2$/i.test(el.tagName) && (tocIds.size ? tocIds.has(el.getAttribute('id')) : true);

  const hdoc = document.implementation.createHTMLDocument('');
  const groups = [];
  let current = null;
  for (const el of body.childNodes) {
    if (el.nodeType === Node.ELEMENT_NODE && isItemStart(el)) {
      current = { id: el.getAttribute('id') || `${fileKey}-${groups.length}`, title: collapse(el.textContent), nodes: [] };
      groups.push(current);
    } else if (current && (el.nodeType === Node.ELEMENT_NODE || (el.nodeType === Node.TEXT_NODE && el.nodeValue.trim()))) {
      // Ook losse tekst: de melding van een bestand-item staat vaak rechtstreeks in de body.
      current.nodes.push(el);
    }
  }
  if (!groups.length) {
    // Geen h2-structuur (bv. syllabus): hele body als één item.
    groups.push({ id: moduleId, title: moduleTitle, nodes: [...body.children].filter((el) => el !== h1 && !(el.tagName === 'OL' && tocIds.size)) });
  }

  const items = [];
  const seen = new Set();
  for (const g of groups) {
    const box = hdoc.createElement('div');
    g.nodes.forEach((n) => box.append(hdoc.importNode(n, true)));
    const rawText = collapse(box.textContent);
    const attachments = [];
    await clean(box, { resolveMedia, stats, attachments });
    const type = itemType(g.title, rawText, box);
    // Een bestand-item heeft geen eigen inhoud: enkel de titel en een lege plek voor de bijlage blijven over.
    if (type === 'bestand') {
      const refs = [...box.querySelectorAll('.file-ref')];
      refs.forEach((r) => r.replaceChildren());
      box.replaceChildren(...refs);
    }
    const hasMedia = !!box.querySelector('img,table,.embed-note');
    const text = collapse(box.textContent);
    // Verwijder afsluitende losse <hr>.
    while (box.lastElementChild && box.lastElementChild.tagName === 'HR') box.lastElementChild.remove();
    let uid = `${fileKey}::${g.id}`;
    for (let n = 2; seen.has(uid); n++) uid = `${fileKey}::${g.id}#${n}`;
    seen.add(uid);
    const empty = !text && !hasMedia && type !== 'bestand';
    items.push({
      uid,
      anchor: g.id,
      mod: fileKey,
      title: g.title || '(zonder titel)',
      kind: leadingEmoji(g.title),
      type,
      empty,
      html: box.innerHTML,
      words: text ? text.split(' ').length : 0,
      images: box.querySelectorAll('img').length,
      attachments,
      // Bestanden zitten niet in de EPUB (alleen een melding), lege items bevatten niets.
      included: !empty && type !== 'bestand',
    });
  }

  return { id: fileKey, anchor: moduleId, file, title: moduleTitle, items, collapsed: true };
}
