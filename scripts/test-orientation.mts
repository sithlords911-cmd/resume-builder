import { createWorker, OEM } from 'tesseract.js';

const worker = await createWorker('eng', OEM.TESSERACT_LSTM_COMBINED);
try {
  for (const f of ['10th mkst.jpg', '12th mkst.jpg', 'trng ctfct.jpg']) {
    const det = await worker.detect(
      `C:/Users/abhis/Downloads/certificate jpeg/${f}`
    );
    console.log(f, '→', JSON.stringify(det.data));
  }
} finally {
  await worker.terminate();
}
