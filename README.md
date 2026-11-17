# DocuResume — OCR-powered résumé builder

Upload your documents — marksheets, certificates, ID proofs, offer letters — and
DocuResume extracts the details and assembles a polished, editable résumé you can
print or save as PDF.

**Everything runs 100% in your browser.** Files are read with the File API,
OCR'd in a Web Worker, and parsed locally. No file is ever uploaded, stored, or
sent to a server. Closing the tab discards everything.

## How it works

1. **Upload** — drag & drop PDFs or images (JPG, PNG, WEBP, TIFF, BMP).
2. **Extract** —
   - Images → [Tesseract.js](https://tesseract.projectnaptha.com/) OCR in a worker.
   - PDFs → [pdf.js](https://mozilla.github.io/pdf.js/) reads the embedded text
     layer; pages with no text layer (scans/photos) are rendered to canvas and
     OCR'd.
3. **Parse** — a heuristic parser (`src/lib/parser.ts`) pulls out contact info,
   education, experience, skills, certifications, projects, achievements and
   languages from the raw text.
4. **Review & edit** — every field is editable before generating.
5. **Export** — two templates (modern / classic) → print or *Save as PDF*.

## Tech stack

- Next.js 16 (App Router, static export-safe) + React 19 + Tailwind CSS 4
- `tesseract.js` — client-side OCR
- `pdfjs-dist` — PDF text layer + page rendering (worker served from `public/`)

## Development

```bash
npm install
npm run dev     # http://localhost:3000
npm run build   # production build
npm run lint
```

### Testing the pipeline locally

`scripts/test-pipeline.mts` runs real OCR on the fixtures in `testdata/` and
prints the extracted résumé JSON:

```bash
npx tsx scripts/test-pipeline.mts
```

## Privacy notes

- No backend routes handle files — the app is a fully static page.
- The OCR engine caches its language data in IndexedDB for speed (browser-local
  storage only, can be cleared anytime). Document contents are never cached.
- Nothing you upload or generate persists after the tab closes.

## Deploy

The app is fully static and deploys to Vercel with zero configuration:

```bash
vercel deploy
```
