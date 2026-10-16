// Editor-UI: boomstructuur met selectie, slepen, filters, voorbeeld en instellingen.
import { state, changed, onChange, allItems, findItem } from './state.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, attrs = {}) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  return e;
};

let activeUid = null;
let sortables = [];

// ---- Instellingen -------------------------------------------------------
const TEXT_FIELDS = ['title', 'subtitle', 'year', 'author'];
const BOOL_FIELDS = ['cover', 'toc', 'tocItems', 'chapterPageBreak', 'itemPageBreak', 'pageNumbers', 'stripEmoji', 'showDetails'];

export function syncSettingsForm() {
  TEXT_FIELDS.forEach((k) => { $('#s-' + k).value = state.settings[k] || ''; });
  BOOL_FIELDS.forEach((k) => { $('#s-' + k).checked = !!state.settings[k]; });
  $('#btnClearLogo').hidden = !state.settings.logo;
  $('#preview').classList.toggle('show-details', !!state.settings.showDetails);
}

function bindSettings() {
  TEXT_FIELDS.forEach((k) => $('#s-' + k).addEventListener('input', (e) => { state.settings[k] = e.target.value; changed(); }));
  BOOL_FIELDS.forEach((k) => $('#s-' + k).addEventListener('change', (e) => {
    state.settings[k] = e.target.checked;
    $('#preview').classList.toggle('show-details', !!state.settings.showDetails);
    changed();
  }));
  $('#s-logo').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { state.settings.logo = r.result; syncSettingsForm(); changed(); };
    r.readAsDataURL(f);
  });
  $('#btnClearLogo').addEventListener('click', () => { state.settings.logo = ''; $('#s-logo').value = ''; syncSettingsForm(); changed(); });
}

// ---- Boom ---------------------------------------------------------------
function itemEl(it) {
  const row = el('div', 'item', { 'data-uid': it.uid });
  const handle = el('span', 'handle ihandle'); handle.textContent = '⠿';
  const cb = el('input', '', { type: 'checkbox' });
  const title = el('span', 'title'); title.textContent = it.title; title.title = it.title;
  const meta = el('span', 'meta');
  meta.textContent = it.empty ? 'leeg' : [it.words ? `${it.words} w` : '', it.images ? `${it.images} afb.` : ''].filter(Boolean).join(' · ');
  const up = el('button', 'mini'); up.textContent = '▲'; up.title = 'Omhoog';
  const down = el('button', 'mini'); down.textContent = '▼'; down.title = 'Omlaag';
  row.append(handle, cb, title, meta, up, down);
  cb.addEventListener('change', () => { it.included = cb.checked; changed(); refresh(); });
  title.addEventListener('click', () => showPreview(it.uid));
  up.addEventListener('click', () => { const p = row.previousElementSibling; if (p) { p.before(row); syncFromDom(); } });
  down.addEventListener('click', () => { const n = row.nextElementSibling; if (n) { n.after(row); syncFromDom(); } });
  return row;
}

function moduleEl(m) {
  const box = el('div', 'module' + (m.collapsed ? ' collapsed' : ''), { 'data-id': m.id });
  const head = el('div', 'module-head');
  const handle = el('span', 'handle mhandle'); handle.textContent = '⠿';
  const tog = el('button', 'toggle'); tog.textContent = m.collapsed ? '▸' : '▾';
  const cb = el('input', '', { type: 'checkbox' });
  const title = el('span', 'title'); title.textContent = m.title;
  const count = el('span', 'count');
  const up = el('button', 'mini'); up.textContent = '▲';
  const down = el('button', 'mini'); down.textContent = '▼';
  head.append(handle, tog, cb, title, count, up, down);
  const list = el('div', 'items');
  m.items.forEach((it) => list.append(itemEl(it)));
  box.append(head, list);

  const toggle = () => { m.collapsed = !m.collapsed; box.classList.toggle('collapsed', m.collapsed); tog.textContent = m.collapsed ? '▸' : '▾'; };
  tog.addEventListener('click', toggle);
  title.addEventListener('click', toggle);
  cb.addEventListener('change', () => { m.items.forEach((i) => { i.included = cb.checked; }); changed(); refresh(); });
  up.addEventListener('click', () => { const p = box.previousElementSibling; if (p) { p.before(box); syncFromDom(); } });
  down.addEventListener('click', () => { const n = box.nextElementSibling; if (n) { n.after(box); syncFromDom(); } });
  return box;
}

export function render() {
  const tree = $('#tree');
  sortables.forEach((s) => s.destroy());
  sortables = [];
  tree.replaceChildren(...state.modules.map(moduleEl));
  sortables.push(Sortable.create(tree, { handle: '.mhandle', animation: 150, onEnd: syncFromDom }));
  tree.querySelectorAll('.items').forEach((l) => sortables.push(Sortable.create(l, { group: 'items', handle: '.ihandle', animation: 150, onEnd: syncFromDom })));
  refresh();
}

function syncFromDom() {
  const items = new Map(allItems().map((i) => [i.uid, i]));
  const mods = new Map(state.modules.map((m) => [m.id, m]));
  const next = [...$('#tree').children].map((me) => {
    const m = mods.get(me.dataset.id);
    m.items = [...me.querySelectorAll('.item')].map((ie) => items.get(ie.dataset.uid));
    return m;
  });
  state.modules = next;
  state.course.modules = next;
  changed();
  refresh();
}

// Werkt vinkjes, tellers, chips en zoekfilter bij zonder de boom opnieuw op te bouwen.
export function refresh() {
  const q = $('#search').value.trim().toLowerCase();
  $('#tree').classList.toggle('searching', !!q);
  for (const me of $('#tree').children) {
    const m = state.modules.find((x) => x.id === me.dataset.id);
    const on = m.items.filter((i) => i.included).length;
    const cb = me.querySelector('.module-head input');
    cb.checked = on === m.items.length && on > 0;
    cb.indeterminate = on > 0 && on < m.items.length;
    me.querySelector('.count').textContent = `${on}/${m.items.length}`;
    let visible = 0;
    me.querySelectorAll('.item').forEach((ie) => {
      const it = findItem(ie.dataset.uid);
      ie.querySelector('input').checked = it.included;
      ie.classList.toggle('excluded', !it.included);
      ie.classList.toggle('active', it.uid === activeUid);
      const hit = !q || it.title.toLowerCase().includes(q);
      ie.classList.toggle('filtered-out', !hit);
      if (hit) visible++;
    });
    me.classList.toggle('filtered-out', !!q && !visible && !m.title.toLowerCase().includes(q));
  }
  const items = allItems();
  const on = items.filter((i) => i.included);
  $('#summary').textContent = `${on.length} van ${items.length} items geselecteerd · ${on.reduce((n, i) => n + i.words, 0).toLocaleString('nl-BE')} woorden · ${on.reduce((n, i) => n + i.images, 0)} afbeeldingen`;
  renderChips();
}

const TYPE_CHIPS = [['bestand', 'Bestanden'], ['opdracht', 'Opdrachten'], ['toets', 'Toetsen']];

function chip(label, list, title) {
  const b = el('button', list.some((i) => i.included) ? '' : 'off');
  b.textContent = `${label} (${list.length})`;
  b.title = title;
  b.disabled = !list.length;
  b.addEventListener('click', () => {
    const all = list.every((i) => i.included);
    list.forEach((i) => { i.included = !all; });
    changed();
    refresh();
  });
  return b;
}

// Filterknoppen: eerst types uit de structuur van het item, daarna enkel de emoji aan het begin van de titel.
function renderChips() {
  const items = allItems();
  const types = TYPE_CHIPS.map(([key, label]) => chip(label, items.filter((i) => i.type === key), 'Alle items van dit type aan/uit'));
  const kinds = new Map();
  items.forEach((i) => {
    if (!i.kind) return;
    if (!kinds.has(i.kind)) kinds.set(i.kind, []);
    kinds.get(i.kind).push(i);
  });
  const emoji = [...kinds].sort((a, b) => b[1].length - a[1].length).map(([k, list]) => chip(k, list, list.slice(0, 3).map((i) => i.title).join('\n')));
  const empty = items.filter((i) => i.empty);
  $('#chips').replaceChildren(...types, ...emoji, ...(empty.length ? [chip('leeg', empty, 'Items zonder inhoud')] : []));
}
// ---- Voorbeeld ----------------------------------------------------------
export function showPreview(uid) {
  const it = findItem(uid);
  if (!it) return;
  activeUid = uid;
  $('#previewHint').hidden = true;
  const box = $('#preview');
  box.replaceChildren();
  const h = el('h2', 'item-title'); h.textContent = it.title;
  const body = el('div', 'item-body'); body.innerHTML = it.html;
  box.append(h, body);
  box.classList.toggle('show-details', !!state.settings.showDetails);
  switchTab('preview');
  refresh();
}

function switchTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $('#tab-settings').hidden = name !== 'settings';
  $('#tab-preview').hidden = name !== 'preview';
}

// ---- Init ---------------------------------------------------------------
export function initEditor() {
  bindSettings();
  $('#search').addEventListener('input', refresh);
  const setAll = (v) => { allItems().forEach((i) => { i.included = v; }); changed(); refresh(); };
  $('#btnAll').addEventListener('click', () => setAll(true));
  $('#btnNone').addEventListener('click', () => setAll(false));
  const setCollapsed = (v) => { state.modules.forEach((m) => { m.collapsed = v; }); render(); };
  $('#btnExpand').addEventListener('click', () => setCollapsed(false));
  $('#btnCollapse').addEventListener('click', () => setCollapsed(true));
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $('#preview').addEventListener('click', (e) => { if (e.target.closest('a')) e.preventDefault(); });
  onChange(({ structural }) => { if (structural) { render(); syncSettingsForm(); } });
}
