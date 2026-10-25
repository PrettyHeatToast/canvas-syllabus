# Canvas → Syllabus

Webtool die een **Canvas-ePub** omzet naar een **PDF-syllabus**. Je kiest welke modules en items (pagina's, oefeningen, antwoordsleutels…) erin komen en in welke volgorde. Alles draait lokaal in de browser: er wordt niets geüpload.

## Gebruik

1. In Canvas: *Cursus → Instellingen → Cursusinhoud exporteren → ePub*.
2. Open de site en sleep het `.epub`-bestand erop.
3. Links: vink hoofdstukken/items aan of uit, sleep ze (⠿) of gebruik ▲▼ om de volgorde te wijzigen. Items kunnen ook naar een ander hoofdstuk gesleept worden. Met de knoppen onder het zoekveld zet je alle items van één type (💪 oefening, 🔑 antwoordsleutel, leeg…) in één klik aan of uit.
4. Klik op een itemtitel voor een voorbeeld. Rechts bij *Instellingen* stel je titel, academiejaar, logo, voorblad en inhoudsopgave in.
5. **Exporteer PDF** → de syllabus wordt gepagineerd (kan bij grote cursussen enkele minuten duren) → **Opslaan als PDF**. Kies in het printvenster: bestemming *Opslaan als PDF*, papierformaat *A4*, marges *Geen*, *Achtergrondafbeeldingen* aan.

Je selectie wordt automatisch bewaard in je browser per cursus. Met **Selectie bewaren / laden** kan je ze als JSON-bestand meenemen, bv. om volgend jaar met een nieuwe export verder te werken (items worden op id of titel teruggevonden).

> Gebruik Chrome of Edge; Paged.js (paginering) werkt het best in Chromium. Laat het tabblad zichtbaar tijdens het opmaken.

## Hosten op GitHub Pages

De site is volledig statisch (geen build). Alle libraries staan in `vendor/`; alleen de lettertypen (Source Sans 3, via `tokens/fonts.css`) komen van Google Fonts. De huisstijl staat in `tokens/`.

1. Zet de bestanden in een GitHub-repository (`index.html` in de root).
2. *Settings → Pages → Build and deployment → Deploy from a branch → `main` / root*.
3. De site staat daarna op `https://<gebruiker>.github.io/<repo>/`.

Lokaal testen kan met elke statische server (modules werken niet via `file://`), bv. `npx serve` of `python -m http.server`.

## Structuur

| Bestand | Rol |
| --- | --- |
| `js/epub.js` | zip openen, OPF lezen, afbeeldingen als blob-URL |
| `js/parse.js` | Canvas-xhtml opsplitsen in modules en items, opschonen |
| `js/state.js` | selectie, volgorde, instellingen, localStorage/JSON |
| `js/ui.js` | boom, slepen, filters, voorbeeld, instellingen |
| `js/export.js` | syllabus-document bouwen en paginering met Paged.js |
| `css/content.css`, `css/print.css` | inhoudsstijl en paginamarges/kop- en voetteksten |
| `vendor/` | JSZip 3.10.1, Paged.js 0.4.3, SortableJS 1.15.2 |
