import { createWorker, OEM } from 'tesseract.js';
import { parseDocuments } from '../src/lib/parser';

const DIR = 'C:/Users/abhis/Downloads/certificate jpeg';
const worker = await createWorker('eng', OEM.LSTM_ONLY);

// upright-rotated versions of the sideways scans (PIL rotate CCW degrees)
try {
  const r90 = await worker.recognize('testdata/mkst_r90.jpg');
  console.log('===== 10th mkst (r90, conf ' + r90.data.confidence.toFixed(0) + ') =====');
  console.log(r90.data.text);
} finally {
  await worker.terminate();
}
