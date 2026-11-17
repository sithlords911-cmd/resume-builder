/* Test: real OCR on generated images -> parseDocuments -> resume JSON */
import { createWorker } from 'tesseract.js';
import { parseDocuments } from '../src/lib/parser';

async function ocr(path: string): Promise<string> {
  const worker = await createWorker('eng');
  try {
    const { data } = await worker.recognize(path);
    return data.text;
  } finally {
    await worker.terminate();
  }
}

const files = ['testdata/marksheet.png', 'testdata/certificate.png'];
const texts: string[] = [];
for (const f of files) {
  const t = await ocr(f);
  texts.push(t);
  console.log(`\n===== OCR: ${f} =====\n${t.slice(0, 1200)}\n`);
}

// Simulated OCR output of an internship letter + a hackathon certificate
texts.push(`EXPERIENCE CERTIFICATE
TechNova Solutions Pvt. Ltd.
This is to certify that Rahul Sharma worked with us as a
Software Developer Intern from June 2023 to December 2023.
During the internship he worked on React, Node.js and PostgreSQL.
`);

texts.push(`SMART INDIA HACKATHON 2024
Winner - First Prize
Awarded to Rahul Sharma for developing
CropDoc - Plant Disease Detection App
Project using Python, TensorFlow and Flutter.
Languages known: English, Hindi, Marathi
`);

const r = parseDocuments(texts);
console.log('===== PARSED RESUME =====');
console.log(JSON.stringify(r, null, 2));
