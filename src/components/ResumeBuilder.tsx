'use client';

import { useCallback, useRef, useState } from 'react';
import { extractText } from '@/lib/ocr';
import { parseDocuments } from '@/lib/parser';
import { BuilderStep, ExtractedFile, ResumeData, emptyResume, uid } from '@/lib/types';
import FileUpload from '@/components/FileUpload';
import ResumeForm from '@/components/ResumeForm';
import ResumePreview, { TemplateId } from '@/components/ResumePreview';

const STEPS: { id: BuilderStep; label: string }[] = [
  { id: 'upload', label: 'Upload' },
  { id: 'processing', label: 'Extract' },
  { id: 'review', label: 'Review & edit' },
  { id: 'preview', label: 'Preview & download' },
];

function StepBar({ step }: { step: BuilderStep }) {
  const idx = STEPS.findIndex((s) => s.id === step);
  return (
    <ol className="flex items-center gap-2 sm:gap-3">
      {STEPS.map((s, i) => (
        <li key={s.id} className="flex items-center gap-2 sm:gap-3">
          <span
            className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition ${
              i < idx
                ? 'bg-emerald-500 text-white'
                : i === idx
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-200 text-slate-500'
            }`}
          >
            {i < idx ? '✓' : i + 1}
          </span>
          <span
            className={`hidden text-sm font-medium sm:inline ${
              i === idx ? 'text-slate-800' : 'text-slate-400'
            }`}
          >
            {s.label}
          </span>
          {i < STEPS.length - 1 && <span className="h-px w-5 bg-slate-300 sm:w-8" />}
        </li>
      ))}
    </ol>
  );
}

function FileCard({
  f,
  onRemove,
  onRetry,
}: {
  f: ExtractedFile;
  onRemove?: () => void;
  onRetry?: () => void;
}) {
  const [showText, setShowText] = useState(false);
  const icon =
    f.status === 'done' ? (
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">✓</span>
    ) : f.status === 'error' ? (
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-100 text-rose-600">!</span>
    ) : f.status === 'processing' ? (
      <span className="flex h-8 w-8 items-center justify-center">
        <svg className="h-5 w-5 animate-spin text-indigo-600" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
      </span>
    ) : (
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-400">…</span>
    );

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-center gap-3">
        {icon}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-800" title={f.fileName}>
            {f.fileName}
          </p>
          <p className="text-xs text-slate-500">
            {f.status === 'done'
              ? `${f.text.length.toLocaleString()} chars extracted${f.pages > 1 ? ` · ${f.pages} pages` : ''}`
              : f.status === 'error'
                ? f.error
                : f.statusText}
          </p>
          {(f.status === 'processing' || f.status === 'pending') && (
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all duration-300"
                style={{ width: `${Math.round(f.progress * 100)}%` }}
              />
            </div>
          )}
        </div>
        {f.status === 'done' && f.text && (
          <button
            type="button"
            onClick={() => setShowText((s) => !s)}
            className="rounded-lg px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
          >
            {showText ? 'Hide text' : 'View text'}
          </button>
        )}
        {f.status === 'error' && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg px-2 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
          >
            Retry
          </button>
        )}
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
            title="Remove file"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
      {showText && f.text && (
        <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600">
          {f.text}
        </pre>
      )}
    </li>
  );
}

export default function ResumeBuilder() {
  const [step, setStep] = useState<BuilderStep>('upload');
  const [files, setFiles] = useState<ExtractedFile[]>([]);
  const [resume, setResume] = useState<ResumeData>(emptyResume());
  const [template, setTemplate] = useState<TemplateId>('modern');
  const [extractedOnce, setExtractedOnce] = useState(false);
  const processingRef = useRef(false);

  const updateFile = useCallback((id: string, patch: Partial<ExtractedFile>) => {
    setFiles((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }, []);

  const processFiles = useCallback(
    async (batch: ExtractedFile[], rawFiles: Map<string, File>, existingTexts: string[]) => {
      if (processingRef.current) return;
      processingRef.current = true;
      const texts = [...existingTexts];
      try {
        for (const ef of batch) {
          const file = rawFiles.get(ef.id);
          if (!file) continue;
          updateFile(ef.id, { status: 'processing', statusText: 'Reading file…', progress: 0 });
          try {
            const result = await extractText(file, (frac, label) =>
              updateFile(ef.id, { progress: frac, statusText: label })
            );
            texts.push(result.text);
            updateFile(ef.id, {
              status: 'done',
              statusText: 'Done',
              progress: 1,
              text: result.text,
              pages: result.pages,
            });
          } catch (err) {
            updateFile(ef.id, {
              status: 'error',
              statusText: 'Failed',
              error: err instanceof Error ? err.message : 'Could not read file',
            });
          }
        }
        if (texts.length) {
          setResume(parseDocuments(texts));
          setExtractedOnce(true);
          setStep('review');
        } else {
          setStep('upload');
        }
      } finally {
        processingRef.current = false;
      }
    },
    [updateFile]
  );

  const fileMapRef = useRef(new Map<string, File>());

  const onFiles = useCallback(
    (selected: File[]) => {
      const batch: ExtractedFile[] = selected.map((f) => {
        const id = uid();
        fileMapRef.current.set(id, f);
        return {
          id,
          fileName: f.name,
          fileType: f.type,
          status: 'pending' as const,
          progress: 0,
          statusText: 'Queued',
          text: '',
          pages: 0,
        };
      });
      setFiles((fs) => [...fs, ...batch]);
      setStep('processing');
      // Texts of already-done files are kept so re-runs merge instead of reset.
      const existing = files.filter((f) => f.status === 'done').map((f) => f.text);
      void processFiles(batch, fileMapRef.current, existing);
    },
    [files, processFiles]
  );

  const retryFile = useCallback(
    (ef: ExtractedFile) => {
      const existing = files.filter((f) => f.status === 'done' && f.id !== ef.id).map((f) => f.text);
      void processFiles([ef], fileMapRef.current, existing);
    },
    [files, processFiles]
  );

  const removeFile = useCallback((ef: ExtractedFile) => {
    fileMapRef.current.delete(ef.id);
    setFiles((fs) => fs.filter((f) => f.id !== ef.id));
  }, []);

  const reset = useCallback(() => {
    fileMapRef.current.clear();
    setFiles([]);
    setResume(emptyResume());
    setExtractedOnce(false);
    setStep('upload');
  }, []);

  const allDone = files.length > 0 && files.every((f) => f.status === 'done' || f.status === 'error');

  return (
    <div className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
      <header className="no-print flex flex-wrap items-center justify-between gap-4 py-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            DocuResume
          </h1>
          <p className="text-sm text-slate-500">
            Documents → résumé, entirely in your browser. Nothing is uploaded.
          </p>
        </div>
        <StepBar step={step} />
      </header>

      {step === 'upload' && (
        <div className="no-print mx-auto max-w-2xl space-y-6">
          <FileUpload onFiles={onFiles} />
          {files.length > 0 && (
            <ul className="space-y-2">
              {files.map((f) => (
                <FileCard key={f.id} f={f} onRemove={() => removeFile(f)} onRetry={f.status === 'error' ? () => retryFile(f) : undefined} />
              ))}
            </ul>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { title: '1. Drop documents', body: 'Marksheets, degree certificates, course certificates, offer letters — PDFs or photos.' },
              { title: '2. We read them locally', body: 'OCR runs in a Web Worker on your device. Files are never sent anywhere.' },
              { title: '3. Edit & export', body: 'Review the extracted details, pick a template, print or save as PDF.' },
            ].map((c) => (
              <div key={c.title} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-800">{c.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 'processing' && (
        <div className="no-print mx-auto max-w-2xl space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-semibold text-slate-800">
              Extracting text from {files.length} file{files.length === 1 ? '' : 's'}…
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              OCR runs entirely on your device — large scans can take a moment.
            </p>
            <ul className="mt-4 space-y-2">
              {files.map((f) => (
                <FileCard key={f.id} f={f} />
              ))}
            </ul>
          </div>
        </div>
      )}

      {step === 'review' && (
        <div className="no-print grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="min-w-0">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-800">
                Review extracted details
              </h2>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStep('upload')}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
                >
                  + Add documents
                </button>
                <button
                  type="button"
                  onClick={() => setStep('preview')}
                  className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
                >
                  Preview résumé →
                </button>
              </div>
            </div>
            <ResumeForm resume={resume} onChange={setResume} />
          </div>
          <aside className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-700">Source documents</h3>
              <ul className="mt-3 space-y-2">
                {files.map((f) => (
                  <FileCard key={f.id} f={f} onRemove={() => removeFile(f)} onRetry={f.status === 'error' ? () => retryFile(f) : undefined} />
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-emerald-800">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
                Private by design
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-emerald-700">
                Your files were read in this tab only. Closing or refreshing the page discards everything — there is no server storage.
              </p>
            </div>
          </aside>
        </div>
      )}

      {step === 'preview' && (
        <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
          <div className="min-w-0">
            <ResumePreview resume={resume} template={template} />
          </div>
          <aside className="no-print space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-700">Template</h3>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {(['modern', 'classic'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTemplate(t)}
                    className={`rounded-xl border-2 px-3 py-2 text-sm font-medium capitalize transition ${
                      template === t
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => window.print()}
                className="mt-4 w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
              >
                Download / print PDF
              </button>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                In the print dialog choose “Save as PDF”. Margins: default or none; enable “Background graphics” for the modern template’s sidebar.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep('review')}
                className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
              >
                ← Edit details
              </button>
              <button
                type="button"
                onClick={reset}
                className="flex-1 rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-50"
              >
                Start over
              </button>
            </div>
            {extractedOnce && (
              <p className="text-[11px] leading-relaxed text-slate-400">
                Tip: everything stays in this tab. “Start over” discards all files and extracted data immediately.
              </p>
            )}
          </aside>
        </div>
      )}
      {allDone && step === 'upload' && (
        <div className="no-print mt-4 text-center">
          <button
            type="button"
            onClick={() => setStep('review')}
            className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Continue to review →
          </button>
        </div>
      )}
    </div>
  );
}
