/**
 * Optional on-device AI pass.
 *
 * A small instruction-tuned LLM (Qwen2.5-1.5B) runs entirely inside the
 * browser via Transformers.js — WebGPU when available, WASM otherwise.
 * The model weights are downloaded once from Hugging Face's public CDN and
 * cached by the browser. No API key, and no user text ever leaves the page:
 * inference happens on-device, exactly like the OCR.
 *
 * The AI output is merged conservatively: it only fills fields the
 * heuristic parser left empty and appends items it missed.
 */
import {
  Certification,
  Education,
  Experience,
  ResumeData,
  uid,
} from './types';

export interface AiProgress {
  (fraction: number, label: string): void;
}

const MODEL_ID = 'onnx-community/Qwen2.5-1.5B-Instruct';
const MAX_DOC_CHARS = 2600;
const MAX_TOTAL_CHARS = 9000;

type Pipeline = (
  messages: { role: string; content: string }[],
  opts: Record<string, unknown>
) => Promise<{ generated_text: { role: string; content: string }[] }[]>;

let pipePromise: Promise<Pipeline> | null = null;

export function aiSupported(): boolean {
  if (typeof navigator === 'undefined') return false;
  // WebGPU preferred; WASM works on everything else (slowly)
  return true;
}

export function hasWebGPU(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

async function getPipe(onProgress: AiProgress): Promise<Pipeline> {
  pipePromise ??= (async () => {
    const { pipeline } = await import('@huggingface/transformers');
    const fileProg = new Map<string, number>();
    const device = hasWebGPU() ? 'webgpu' : 'wasm';
    const p = await pipeline('text-generation', MODEL_ID, {
      dtype: 'q4',
      device,
      progress_callback: (info: {
        status?: string;
        file?: string;
        progress?: number;
      }) => {
        if (info.status === 'progress' && info.file) {
          fileProg.set(info.file, info.progress ?? 0);
          const vals = [...fileProg.values()];
          const avg = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
          onProgress(
            Math.min(avg / 100, 0.98),
            `Downloading AI model (${vals.length} files)…`
          );
        } else if (info.status === 'ready') {
          onProgress(0.99, 'Loading model…');
        }
      },
    });
    return p as unknown as Pipeline;
  })();
  return pipePromise;
}

function buildPrompt(texts: string[]): { role: string; content: string }[] {
  let budget = MAX_TOTAL_CHARS;
  const docs = texts
    .map((t, i) => {
      const slice = t.slice(0, Math.min(MAX_DOC_CHARS, budget));
      budget -= slice.length;
      return `--- Document ${i + 1} ---\n${slice}`;
    })
    .filter(Boolean)
    .join('\n\n');

  return [
    {
      role: 'system',
      content:
        'You extract resume fields from OCR text of scanned documents ' +
        '(marksheets, certificates, ID cards, training letters). ' +
        'OCR is noisy — ignore garbage characters. ' +
        'Reply with ONLY a JSON object, no markdown, no explanation.',
    },
    {
      role: 'user',
      content:
        `OCR text of the candidate's documents:\n${docs}\n\n` +
        'Extract this JSON (use "" or [] when unknown):\n' +
        '{"name":"","email":"","phone":"","location":"","title":"",' +
        '"summary":"","education":[{"degree":"","institution":"","field":"",' +
        '"startYear":"","endYear":"","grade":""}],' +
        '"experience":[{"role":"","company":"","startDate":"","endDate":""}],' +
        '"skills":[],"certifications":[{"name":"","issuer":"","year":""}],' +
        '"projects":[{"name":"","description":"","tech":""}],' +
        '"achievements":[],"languages":[]}',
    },
  ];
}

function extractJson(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    // try trimming to balanced braces
    let depth = 0;
    let close = -1;
    for (let i = start; i < raw.length; i++) {
      if (raw[i] === '{') depth++;
      else if (raw[i] === '}') {
        depth--;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close > start) {
      try {
        return JSON.parse(raw.slice(start, close + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

const s = (v: unknown): string =>
  typeof v === 'string' ? v.trim() : '';
const sa = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(s).filter(Boolean) : [];
const oa = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : [];

function norm(x: string): string {
  return x.toLowerCase().replace(/[^\w]+/g, ' ').trim();
}

/** AI fills gaps the heuristic left; never overwrites user-visible data. */
export function mergeAiResult(base: ResumeData, ai: Record<string, unknown>): ResumeData {
  const r: ResumeData = { ...base };

  r.name ||= s(ai.name);
  r.email ||= s(ai.email);
  r.phone ||= s(ai.phone);
  r.location ||= s(ai.location);
  r.title ||= s(ai.title);
  r.summary ||= s(ai.summary);

  const aiEdu: Education[] = oa(ai.education).map((e) => ({
    id: uid(),
    degree: s(e.degree),
    institution: s(e.institution),
    field: s(e.field),
    startYear: s(e.startYear),
    endYear: s(e.endYear),
    grade: s(e.grade),
  }));
  for (const e of aiEdu) {
    const dup = r.education.find(
      (x) => norm(x.degree) === norm(e.degree) || norm(x.institution) === norm(e.institution)
    );
    if (dup) {
      dup.institution ||= e.institution;
      dup.field ||= e.field;
      dup.startYear ||= e.startYear;
      dup.endYear ||= e.endYear;
      dup.grade ||= e.grade;
      dup.degree ||= e.degree;
    } else if (e.degree || e.institution) {
      r.education.push(e);
    }
  }

  const aiExp: Experience[] = oa(ai.experience).map((e) => ({
    id: uid(),
    role: s(e.role),
    company: s(e.company),
    startDate: s(e.startDate),
    endDate: s(e.endDate),
    description: s(e.description),
  }));
  for (const e of aiExp) {
    const dup = r.experience.find(
      (x) => norm(x.role) === norm(e.role) && norm(x.company) === norm(e.company)
    );
    if (dup) {
      dup.startDate ||= e.startDate;
      dup.endDate ||= e.endDate;
      dup.company ||= e.company;
    } else if (e.role || e.company) {
      r.experience.push(e);
    }
  }

  const aiCerts: Certification[] = oa(ai.certifications).map((c) => ({
    id: uid(),
    name: s(c.name),
    issuer: s(c.issuer),
    year: s(c.year),
  }));
  for (const c of aiCerts) {
    if (
      !r.certifications.some(
        (x) => norm(x.name) === norm(c.name) && norm(x.issuer) === norm(c.issuer)
      ) &&
      c.name.length > 3
    )
      r.certifications.push(c);
  }

  const aiProj: ResumeData['projects'][number][] = oa(ai.projects).map((p) => ({
    id: uid(),
    name: s(p.name),
    description: s(p.description),
    tech: s(p.tech),
  }));
  for (const p of aiProj) {
    if (
      !r.projects.some((x) => norm(x.name) === norm(p.name)) &&
      p.name.length > 3
    )
      r.projects.push(p);
  }

  for (const sk of sa(ai.skills)) {
    if (!r.skills.some((x) => norm(x) === norm(sk))) r.skills.push(sk);
  }
  for (const a of sa(ai.achievements)) {
    if (!r.achievements.some((x) => norm(x) === norm(a))) r.achievements.push(a);
  }
  for (const l of sa(ai.languages)) {
    if (!r.languages.some((x) => norm(x) === norm(l))) r.languages.push(l);
  }

  return r;
}

export async function enhanceWithAi(
  texts: string[],
  onProgress: AiProgress
): Promise<Record<string, unknown> | null> {
  const pipe = await getPipe(onProgress);
  onProgress(0.99, 'Analysing documents…');
  const out = await pipe(buildPrompt(texts), {
    max_new_tokens: 700,
    do_sample: false,
  });
  const gen = out[0]?.generated_text;
  const last = Array.isArray(gen) ? gen[gen.length - 1]?.content : '';
  return extractJson(typeof last === 'string' ? last : '');
}
