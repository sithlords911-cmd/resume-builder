'use client';

import { useCallback, useRef, useState } from 'react';
import { isSupportedFile } from '@/lib/ocr';

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff';
const MAX_MB = 25;

export default function FileUpload({
  onFiles,
  compact,
}: {
  onFiles: (files: File[]) => void;
  compact?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const handle = useCallback(
    (list: FileList | File[]) => {
      const ok: File[] = [];
      const bad: string[] = [];
      for (const f of Array.from(list)) {
        if (!isSupportedFile(f)) bad.push(`${f.name} (unsupported type)`);
        else if (f.size > MAX_MB * 1024 * 1024) bad.push(`${f.name} (over ${MAX_MB}MB)`);
        else if (f.size === 0) bad.push(`${f.name} (empty)`);
        else ok.push(f);
      }
      setRejected(bad);
      if (ok.length) onFiles(ok);
    },
    [onFiles]
  );

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload documents"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handle(e.dataTransfer.files);
        }}
        className={`cursor-pointer rounded-2xl border-2 border-dashed transition-all duration-200 text-center ${
          dragging
            ? 'border-indigo-500 bg-indigo-50 scale-[1.01]'
            : 'border-slate-300 bg-white hover:border-indigo-400 hover:bg-indigo-50/40'
        } ${compact ? 'p-6' : 'p-10 sm:p-14'}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) handle(e.target.files);
            e.target.value = '';
          }}
        />
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-100">
          <svg
            className="h-7 w-7 text-indigo-600"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.8}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 8.25H7.5a2.25 2.25 0 00-2.25 2.25v9a2.25 2.25 0 002.25 2.25h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25H15m0-3l-3-3m0 0l-3 3m3-3V15"
            />
          </svg>
        </div>
        <p className="text-base font-semibold text-slate-800">
          Drop your documents here, or <span className="text-indigo-600">browse</span>
        </p>
        <p className="mt-1 text-sm text-slate-500">
          PDFs and images (JPG, PNG, WEBP, TIFF) — marksheets, certificates, IDs, anything.
        </p>
        {!compact && (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            Files never leave your device
          </p>
        )}
      </div>
      {rejected.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-rose-600">
          {rejected.map((r) => (
            <li key={r}>Skipped: {r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
