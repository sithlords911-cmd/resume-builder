/**
 * Client-side text extraction.
 *
 * Everything in this module runs in the browser. Files are read via the
 * File/ArrayBuffer APIs, rendered on <canvas> when needed, and OCR'd with
 * Tesseract.js in a Web Worker. Nothing is uploaded, persisted or sent to a
 * server — the File objects never leave the page.
 */

export interface OcrProgress {
  (fraction: number, label: string): void;
}

export interface OcrResult {
  text: string;
  pages: number;
  ocrPages: number; // pages that needed OCR (vs embedded text)
}

const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/bmp',
  'image/tiff',
]);

const MAX_PAGES = 12; // per PDF, keeps processing snappy
const MIN_TEXT_LAYER = 40; // chars/page below which a page is treated as scanned

export function isSupportedFile(file: File): boolean {
  return IMAGE_TYPES.has(file.type) || file.type === 'application/pdf';
}

export async function extractText(
  file: File,
  onProgress: OcrProgress
): Promise<OcrResult> {
  if (file.type === 'application/pdf') {
    return extractFromPdf(file, onProgress);
  }
  if (IMAGE_TYPES.has(file.type)) {
    return extractFromImage(file, onProgress);
  }
  throw new Error(`Unsupported file type: ${file.type || file.name}`);
}

async function extractFromImage(
  file: File,
  onProgress: OcrProgress
): Promise<OcrResult> {
  const worker = await createOcrWorker((f) =>
    onProgress(0.15 + f * 0.8, 'Running OCR on image')
  );
  try {
    onProgress(0.05, 'Loading image');
    const { data } = await worker.recognize(file);
    onProgress(1, 'Done');
    return { text: data.text, pages: 1, ocrPages: 1 };
  } finally {
    await worker.terminate();
  }
}

async function extractFromPdf(
  file: File,
  onProgress: OcrProgress
): Promise<OcrResult> {
  onProgress(0.02, 'Loading PDF');
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data });
  const pdf = await loadingTask.promise;
  const pageCount = Math.min(pdf.numPages, MAX_PAGES);

  const texts: string[] = [];
  let ocrPages = 0;
  const workers: import('tesseract.js').Worker[] = [];

  const ensureWorker = async () => {
    if (!workers.length) {
      workers.push(await createOcrWorker(() => {}));
    }
    return workers[0];
  };

  try {
    for (let i = 1; i <= pageCount; i++) {
      const base = (i - 1) / pageCount;
      const span = 1 / pageCount;
      const page = await pdf.getPage(i);

      onProgress(base, `Reading page ${i}/${pageCount}`);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (pageText.length >= MIN_TEXT_LAYER) {
        texts.push(pageText);
        continue;
      }

      // Scanned page — render to canvas and OCR it.
      ocrPages++;
      const w = await ensureWorker();
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvas, viewport }).promise;

      const { data: ocrData } = await w.recognize(canvas);
      texts.push(ocrData.text);
      onProgress(base + span, `OCR'd page ${i}/${pageCount}`);
      canvas.width = 0; // release backing buffer
      canvas.height = 0;
    }
  } finally {
    for (const w of workers) await w.terminate();
    await loadingTask.destroy();
  }

  onProgress(1, 'Done');
  return { text: texts.join('\n\n'), pages: pageCount, ocrPages };
}

async function createOcrWorker(onOcrProgress: (f: number) => void) {
  const Tesseract = await import('tesseract.js');
  return Tesseract.createWorker('eng', Tesseract.OEM.LSTM_ONLY, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') {
        onOcrProgress(m.progress);
      }
    },
  });
}
