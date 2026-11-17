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

/* ------------------------------------------------------------------ */
/* Orientation handling                                                 */
/*                                                                      */
/* Real-world scans of certificates/marksheets are frequently stored   */
/* sideways — either via EXIF orientation tags or baked into pixels.   */
/* Browsers honour EXIF when decoding into an ImageBitmap, but files  */
/* with baked-in rotation still need detection. We analyse the ink     */
/* banding: upright text creates strong horizontal density stripes.    */
/* ------------------------------------------------------------------ */

function rotateCanvas(src: HTMLCanvasElement, deg: number): HTMLCanvasElement {
  const out = document.createElement('canvas');
  const swap = deg === 90 || deg === 270;
  out.width = swap ? src.height : src.width;
  out.height = swap ? src.width : src.height;
  const ctx = out.getContext('2d')!;
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return out;
}

function downscaled(src: HTMLCanvasElement, maxDim: number): HTMLCanvasElement {
  const scale = Math.min(1, maxDim / Math.max(src.width, src.height));
  if (scale >= 1) return src;
  const out = document.createElement('canvas');
  out.width = Math.round(src.width * scale);
  out.height = Math.round(src.height * scale);
  out.getContext('2d')!.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

type OrientationGuess = 'upright' | 'rotated' | 'ambiguous';

/**
 * Compare horizontal vs vertical ink-density variance. Text-heavy pages
 * produce strong row banding when upright; rotated pages flip it.
 */
function guessOrientation(canvas: HTMLCanvasElement): OrientationGuess {
  const probe = downscaled(canvas, 220);
  const ctx = probe.getContext('2d', { willReadFrequently: true })!;
  const { width, height } = probe;
  const px = ctx.getImageData(0, 0, width, height).data;

  const rows = new Float64Array(height);
  const cols = new Float64Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = (px[i] * 3 + px[i + 1] * 6 + px[i + 2]) / 10;
      if (lum < 140) {
        rows[y]++;
        cols[x]++;
      }
    }
  }
  const cv = (a: Float64Array) => {
    let s = 0, s2 = 0;
    for (const v of a) {
      s += v;
      s2 += v * v;
    }
    const mean = s / a.length;
    return mean === 0 ? 0 : Math.sqrt(s2 / a.length - mean * mean) / mean;
  };
  const rowCv = cv(rows);
  const colCv = cv(cols);
  if (rowCv > colCv * 1.15) return 'upright';
  if (colCv > rowCv * 1.15) return 'rotated';
  return 'ambiguous';
}

/**
 * OCR a canvas, automatically resolving sideways/upside-down scans.
 * Rotated/ambiguous pages are probed at low resolution first so we pay
 * the full-resolution cost only once.
 */
async function recognizeUpright(
  worker: import('tesseract.js').Worker,
  canvas: HTMLCanvasElement
) {
  const guess = guessOrientation(canvas);
  if (guess === 'upright') {
    return (await worker.recognize(canvas)).data;
  }
  const low = downscaled(canvas, 900);
  const candidates = guess === 'rotated' ? [90, 270] : [0, 90, 180, 270];
  let bestDeg = 0;
  let bestScore = -1;
  for (const deg of candidates) {
    const probe = deg === 0 ? low : rotateCanvas(low, deg);
    const { data } = await worker.recognize(probe);
    const score = data.confidence + Math.min(data.text.length / 400, 10);
    if (score > bestScore) {
      bestScore = score;
      bestDeg = deg;
    }
  }
  const final = bestDeg === 0 ? canvas : rotateCanvas(canvas, bestDeg);
  return (await worker.recognize(final)).data;
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
    // createImageBitmap honours EXIF orientation ('from-image'), so photos
    // taken sideways decode upright before Tesseract ever sees them.
    const bitmap = await createImageBitmap(file, {
      imageOrientation: 'from-image',
    });
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    bitmap.close();
    const data = await recognizeUpright(worker, canvas);
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

      const ocrData = await recognizeUpright(w, canvas);
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
