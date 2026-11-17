import { createWorker, OEM } from 'tesseract.js';

const worker = await createWorker('eng', OEM.LSTM_ONLY);
try {
  const files = [
    ['orig', 'C:/Users/abhis/Downloads/certificate jpeg/10th mkst.jpg'],
    ['r90 ', 'testdata/mkst_r90.jpg'],
    ['r180', 'testdata/mkst_r180.jpg'],
    ['r270', 'testdata/mkst_r270.jpg'],
  ] as const;
  for (const [tag, f] of files) {
    const { data } = await worker.recognize(f);
    console.log(
      `${tag} conf=${data.confidence?.toFixed?.(1)} chars=${data.text.length} | ${data.text.slice(0, 80).replace(/\n/g, ' | ')}`
    );
  }
} finally {
  await worker.terminate();
}
