import { loadEpub } from './epub.js';
import { state, setCourse, serialize, applySaved, changed } from './state.js';
import { initEditor, syncSettingsForm } from './ui.js';
import { renderPaged, clearPaged } from './export.js';

const $ = (s) => document.querySelector(s);

async function openFile(file) {
  const status = $('#loadStatus');
  status.hidden = false;
  status.textContent = 'EPUB openen…';
  try {
    const course = await loadEpub(file, (msg) => { status.textContent = msg; });
    state.course?.dispose?.();
    $('#start').hidden = true;
    $('#editor').hidden = false;
    $('#topActions').hidden = false;
    setCourse(course);
    if (course.stats.missingImages) console.warn(`${course.stats.missingImages} afbeelding(en) niet gevonden in EPUB`);
  } catch (err) {
    console.error(err);
    status.textContent = 'Kon dit bestand niet lezen: ' + err.message;
  }
}

const dz = $('#dropzone');
$('#epubFile').addEventListener('change', (e) => e.target.files[0] && openFile(e.target.files[0]));
['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
dz.addEventListener('drop', (e) => e.dataTransfer.files[0] && openFile(e.dataTransfer.files[0]));
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

$('#btnNew').addEventListener('click', () => {
  if (!confirm('Ander bestand openen? Je selectie blijft bewaard in deze browser.')) return;
  $('#editor').hidden = true;
  $('#topActions').hidden = true;
  $('#start').hidden = false;
  $('#loadStatus').hidden = true;
  $('#epubFile').value = '';
});

// Selectie als JSON bewaren/laden
$('#btnSave').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(serialize(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'syllabus-selectie.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('#btnLoad').addEventListener('click', () => $('#selectionFile').click());
$('#selectionFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    applySaved(JSON.parse(await f.text()));
    changed({ structural: true });
  } catch (err) {
    alert('Kon selectiebestand niet lezen: ' + err.message);
  }
});

// Export
$('#btnExport').addEventListener('click', async () => {
  const overlay = $('#export-overlay');
  const status = $('#exportStatus');
  const print = $('#btnPrint');
  overlay.hidden = false;
  document.body.classList.add('exporting');
  print.disabled = true;
  try {
    const { pages, ms } = await renderPaged($('#pages'), (m) => { status.textContent = m; });
    status.textContent = `Klaar: ${pages} pagina’s (${(ms / 1000).toFixed(1)} s)`;
    print.disabled = false;
  } catch (err) {
    console.error(err);
    status.textContent = 'Fout: ' + err.message;
  }
});
$('#btnPrint').addEventListener('click', () => window.print());
$('#btnCloseExport').addEventListener('click', () => {
  $('#export-overlay').hidden = true;
  document.body.classList.remove('exporting');
  clearPaged($('#pages'));
});

initEditor();
syncSettingsForm();
