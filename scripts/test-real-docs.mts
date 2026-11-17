import { createWorker, OEM } from 'tesseract.js';
import { parseDocuments } from '../src/lib/parser';
import * as fs from 'fs';

const DIR = 'testdata/docs';
const CACHE = 'testdata/ocr-out.json';
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.png'));

let texts: Record<string, string> = {};
if (fs.existsSync(CACHE)) {
  texts = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  console.log(`using cached OCR for ${Object.keys(texts).length} docs`);
}
const missing = files.filter((f) => !texts[f]);
if (missing.length) {
  const worker = await createWorker('eng', OEM.LSTM_ONLY);
  try {
    for (const f of missing) {
      const { data } = await worker.recognize(`${DIR}/${f}`);
      texts[f] = data.text;
      console.log(`OCR'd ${f} (conf ${data.confidence.toFixed(0)})`);
    }
  } finally {
    await worker.terminate();
  }
  fs.writeFileSync(CACHE, JSON.stringify(texts, null, 2));
}

// resume-relevant docs only, for the combined parse
const resumeDocs = files.filter(
  (f) => !/pancrd|vtrid|psbk|mum|papa/.test(f)
);
const r = parseDocuments(resumeDocs.map((f) => texts[f]));
console.log('\n===== PARSED (resume docs only) =====');
console.log(JSON.stringify(r, null, 2));

// also parse with ALL docs — parser should gate ID/bank docs itself
const r2 = parseDocuments(files.map((f) => texts[f]));
console.log('\n===== PARSED (all docs, incl. IDs) =====');
console.log(JSON.stringify({ name: r2.name, email: r2.email, phone: r2.phone, website: r2.website, location: r2.location, edu: r2.education.length, certs: r2.certifications.length, skills: r2.skills }, null, 2));
