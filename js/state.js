// Centrale toestand: cursus, volgorde, selectie en instellingen (met bewaren in localStorage).
import { linkAttachments } from './attachments.js';

export const DEFAULT_SETTINGS = {
  title: '',
  subtitle: 'Syllabus',
  year: '',
  author: '',
  logo: '',
  cover: true,
  toc: true,
  tocItems: true,
  chapterPageBreak: true,
  itemPageBreak: false,
  showDetails: false,
  stripEmoji: false,
  pageNumbers: true,
};

export const state = { course: null, zip: null, modules: [], settings: { ...DEFAULT_SETTINGS } };

const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
let saveTimer;

export function changed({ structural = false } = {}) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 300);
  listeners.forEach((fn) => fn({ structural }));
}

const storageKey = () => 'canvas-syllabus:v1:' + state.course.id;

function save() {
  if (!state.course) return;
  try { localStorage.setItem(storageKey(), JSON.stringify(serialize())); } catch { /* quota/privé modus */ }
}

export function serialize() {
  return {
    v: 1,
    id: state.course.id,
    title: state.course.title,
    settings: state.settings,
    modules: state.modules.map((m) => ({
      id: m.id, title: m.title,
      items: m.items.map((i) => ({
        id: i.uid, title: i.title, included: i.included,
        attachments: i.attachments.map(({ name, path, included }) => ({ name, path, included })),
      })),
    })),
  };
}

export function setCourse(course) {
  state.course = course;
  state.modules = course.modules;
  state.settings = { ...DEFAULT_SETTINGS, title: course.title };
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(storageKey())); } catch { /* negeren */ }
  if (saved) applySaved(saved);
  if (state.zip) linkAttachments(allItems(), state.zip);
  changed({ structural: true });
}

export function setZip(zip) {
  state.zip = zip;
  if (!zip || !state.course) return;
  linkAttachments(allItems(), zip);
  // Open de hoofdstukken waar nog een bestand gekozen moet worden.
  state.modules.forEach((m) => { if (m.items.some((i) => i.attachments.some((a) => !a.path))) m.collapsed = false; });
  changed({ structural: true });
}

// Past een eerder bewaarde selectie/volgorde toe (zoekt items op id, daarna op titel).
export function applySaved(saved) {
  const items = state.modules.flatMap((m) => m.items);
  const byId = new Map(items.map((i) => [i.uid, i]));
  const byTitle = new Map();
  items.forEach((i) => { if (!byTitle.has(i.title)) byTitle.set(i.title, []); byTitle.get(i.title).push(i); });
  const shells = new Map(state.modules.map((m) => [m.id, m]));
  const shellByTitle = new Map(state.modules.map((m) => [m.title, m]));
  const used = new Set();
  const out = [];
  const shellsUsed = new Set();
  const origItems = new Map(state.modules.map((m) => [m, m.items]));
  state.modules.forEach((m) => { m.items = []; });

  for (const sm of saved.modules || []) {
    const mod = shells.get(sm.id) || shellByTitle.get(sm.title);
    if (!mod || shellsUsed.has(mod)) continue;
    shellsUsed.add(mod);
    out.push(mod);
    for (const si of sm.items || []) {
      let it = byId.get(si.id);
      if (!it || used.has(it)) it = (byTitle.get(si.title) || []).find((x) => !used.has(x));
      if (!it) continue;
      used.add(it);
      it.included = !!si.included;
      it.attachments.forEach((a) => {
        const sa = si.attachments?.find((x) => x.name === a.name);
        if (sa) { a.path = sa.path; a.included = sa.included; }
      });
      mod.items.push(it);
    }
  }
  // Nieuwe modules/items die niet in de bewaarde selectie zaten: op hun oorspronkelijke plek achteraan.
  for (const [mod, orig] of origItems) {
    if (!shellsUsed.has(mod)) { out.push(mod); shellsUsed.add(mod); }
    for (const it of orig) if (!used.has(it)) { mod.items.push(it); used.add(it); }
  }
  state.modules = out;
  state.course.modules = out;
  if (saved.settings) state.settings = { ...state.settings, ...saved.settings };
}

export const allItems = () => state.modules.flatMap((m) => m.items);
export const findItem = (uid) => allItems().find((i) => i.uid === uid);
