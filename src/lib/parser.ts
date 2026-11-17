/**
 * Heuristic parser that converts raw OCR/text-layer output from documents
 * (marksheets, certificates, IDs, CVs…) into structured resume data.
 * Tuned for real-world scans — including Indian board certificates
 * (CBSE/State), university grade sheets, training certificates and ID cards.
 * Runs entirely in the browser on the extracted text — no data leaves.
 */
import { SKILL_MAP } from './skills';
import {
  Certification,
  Education,
  Experience,
  Project,
  ResumeData,
  emptyResume,
  uid,
} from './types';

/* ------------------------------------------------------------------ */
/* Normalisation helpers                                               */
/* ------------------------------------------------------------------ */

function normalise(text: string): string {
  return text
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function lines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(Of|And|The|In|For|De|Di|Van|Von|Ka|Ki|Ke)\b/g, (m) =>
      m.toLowerCase()
    );
}

/* ------------------------------------------------------------------ */
/* Contact info — prefer personal over institutional contacts          */
/* ------------------------------------------------------------------ */

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const EMAIL_ONE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const IN_MOBILE_RE = /(?:\+?91[-\s]?|0)?([6-9]\d{9})\b/;
const LINKEDIN_RE = /(?:linkedin\.com\/in\/|linkedin\.com\/)[\w-]+/i;
const GITHUB_RE = /github\.com\/[\w-]+/i;
const URL_RE = /https?:\/\/[^\s)>"']+/gi;

const INSTITUTIONAL_LOCAL =
  /^(director|registrar|office|admission|admissions|info|admin|contact|helpdesk|support|principal|exam|examination|cell|hr|accounts|mail|enquiry|query|feedback|noreply|no-reply|chairman|dean|hod|vc|proctor)@/i;
const INSTITUTION_LINE =
  /institut|college|universit|school|board|academy|polytechnic|vidyalaya|bank|branch|office|ph\.?\s*[:：]|fax|website|registrar|director|principal/i;

function extractEmail(text: string): string {
  const emails = [...text.matchAll(EMAIL_RE)].map((m) => m[0].toLowerCase());
  if (!emails.length) return '';
  // personal-looking local parts beat institutional ones; if every email is
  // institutional (director@college…), it isn't the candidate's — skip it
  const personal = emails.filter((e) => !INSTITUTIONAL_LOCAL.test(e));
  return personal[0] ?? '';
}

function extractPhone(text: string): string {
  // 1) Labelled mobile/contact numbers ("Mobile No.:", "Contact:")
  for (const m of text.matchAll(
    /(?:mobile|contact|cell|mob)\.?\s*(?:no\.?|number|#)?\s*[:.\-–]?\s*([+\d][\d\s\-(),]{7,20}\d)/gi
  )) {
    const mob = IN_MOBILE_RE.exec(m[1]);
    if (mob) return '+91' + mob[1];
    const digits = m[1].replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 12)
      return '+' + digits.replace(/^0+/, '');
  }
  // 2) Any Indian mobile pattern anywhere
  const mob = IN_MOBILE_RE.exec(text);
  if (mob) return '+91' + mob[1];
  // 3) Generic labelled phone
  const labelled =
    /(?:phone|tel|ph)\.?\s*(?:no\.?|number)?\s*[:.\-–]?\s*([+\d][\d\s\-()]{7,16}\d)/i.exec(
      text
    );
  if (labelled) {
    const digits = labelled[1].replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 15)
      return '+' + digits.replace(/^0+/, '');
  }
  return '';
}

function extractLinks(text: string) {
  const urls = text.match(URL_RE) ?? [];
  const bare = text.match(/(?:www\.)[\w.-]+\.[a-z]{2,}(?:\/\S*)?/gi) ?? [];
  const all = [...urls, ...bare.map((u) => 'https://' + u)];

  let linkedin = '';
  let github = '';
  let website = '';
  for (const u of all) {
    if (LINKEDIN_RE.test(u) && !linkedin) linkedin = u;
    else if (GITHUB_RE.test(u) && !github) github = u;
  }
  const liMatch = LINKEDIN_RE.exec(text);
  const ghMatch = GITHUB_RE.exec(text);
  if (!linkedin && liMatch) linkedin = 'https://' + liMatch[0];
  if (!github && ghMatch) github = 'https://' + ghMatch[0];

  // website: skip institutional pages and social domains
  const lns = lines(text);
  for (const u of all) {
    if (/linkedin|github|facebook|instagram|twitter|x\.com|youtube|whatsapp/i.test(u))
      continue;
    const srcLine = lns.find((l) => l.includes(u.replace(/^https?:\/\//, '').split('/')[0]));
    if (srcLine && INSTITUTION_LINE.test(srcLine)) continue;
    website = u;
    break;
  }
  return { linkedin, github, website };
}

/* ------------------------------------------------------------------ */
/* Name — collect candidates across docs and vote                      */
/* ------------------------------------------------------------------ */

// "Name X", "Name : X", "Name - X", "NAME OF CANDIDATE : X" (Indian boards)
const NAME_LABEL_RES = [
  /(?:^|\b)name\s+(?:of\s+)?(?:the\s+)?(?:candidate|student|applicant|trainee|participant|holder)[\s:.\-–]*([A-Za-z][A-Za-z .'’]{2,50})/i,
  /(?:^|\b)candidate'?s?\s+name[\s:.\-–]*([A-Za-z][A-Za-z .'’]{2,50})/i,
  /(?:^|\b)name\s*[\s:.\-–]{1,4}\s*([A-Za-z][A-Za-z .'’]{2,50})/i,
  /(?:^|\b)name\s{1,3}([A-Z][A-Za-z.'' ]{3,45})/i, // "Name ABHISHEK KUMAR"
];
const CERT_NAME_RES = [
  /certif\w*\s+that\s+(?:mr\.?|ms\.?|mrs\.?|shri|smt\.?|sri|kum(?:ari)?\.?|dr\.?|km\.?)?\s*([A-Z][A-Za-z .'’]{2,45})/i,
  /awarded\s+to\s+(?:mr\.?|ms\.?|mrs\.?|shri|smt\.?|sri|kum(?:ari)?\.?|dr\.?)?\s*([A-Z][A-Za-z .'’]{2,45})/i,
  /presented\s+to\s+(?:mr\.?|ms\.?|mrs\.?|shri|smt\.?|sri|kum(?:ari)?\.?|dr\.?)?\s*([A-Z][A-Za-z .'’]{2,45})/i,
  /conferred\s+(?:up)?on\s+(?:mr\.?|ms\.?|mrs\.?|shri|smt\.?|sri|kum(?:ari)?\.?|dr\.?)?\s*([A-Z][A-Za-z .'’]{2,45})/i,
];
// label words that end a name capture ("Name X Roll No...", "Name X Father's...")
const NAME_STOP_RE =
  /\s+(?:roll|roli|enrol|father|mother|guardian|dob|date|born|s\/o|d\/o|w\/o|son|daughter|of|batch|program|course|adm|reg|id|year|sex|age|address|exam|board|school|college|institute|university|marksheet|certificate|passed|held|session|branch|semester|grade|cgpa|marks|no\b)\b.*/i;
// words that make a line NOT a person's own name field
const PARENT_RE = /(father|mother|guardian|husband|wife|parent)'?s?\s+name/i;

const NAME_NOISE =
  /\b(school|college|university|institute|board|certificate|marksheet|statement|grade|roll|exam|father|mother|guardian|course|program|project|team|company|address|branch|session|subject|marks|result|of the|of candidate)\b/i;

const NAME_CONNECTIVES = new Set([
  'a', 'an', 'the', 'for', 'of', 'in', 'on', 'at', 'has', 'have', 'had', 'is',
  'was', 'were', 'we', 'our', 'they', 'he', 'she', 'his', 'her', 'their', 'its',
  'to', 'from', 'by', 'and', 'or', 'this', 'that', 'these', 'mr', 'mrs', 'ms',
  'shri', 'smt', 'sri', 'kum', 'kumari', 'dr', 'km', 'xe', 'ms',
]);

function cleanName(raw: string): string {
  const stripped = raw
    .replace(NAME_STOP_RE, '')
    .replace(/[^A-Za-z .'’]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const words = stripped
    .split(' ')
    .filter((w) => /^[A-Za-z.'’]+$/.test(w) && w.length > 1);
  // drop leading connectives/honorifics and trailing single junk letters
  while (words.length && NAME_CONNECTIVES.has(words[0].toLowerCase()))
    words.shift();
  while (words.length && words[words.length - 1].length < 2) words.pop();
  const kept = words.slice(0, 4);
  if (kept.length < 2) return '';
  // truncate at first word that doesn't look name-like (e.g. OCR junk tail)
  const nameWords: string[] = [];
  for (const w of kept) {
    if (!/^[A-Z][A-Za-z'’.]*$|^[A-Z]$/.test(w)) break;
    nameWords.push(w);
  }
  if (nameWords.length < 2) return '';
  const n = nameWords.join(' ');
  if (NAME_NOISE.test(n)) return '';
  return titleCase(n);
}

/** All name candidates in one doc, best-first. */
export function nameCandidates(text: string): string[] {
  const out: string[] = [];
  const ls = lines(text);

  for (const re of NAME_LABEL_RES) {
    for (const l of ls) {
      if (PARENT_RE.test(l)) continue;
      const m = re.exec(l);
      if (m) {
        const n = cleanName(m[1]);
        if (n) out.push(n);
      }
    }
  }
  for (const re of CERT_NAME_RES) {
    const m = re.exec(text);
    if (m) {
      const n = cleanName(m[1]);
      if (n) out.push(n);
    }
  }
  return out;
}

function guessNameFromLines(text: string): string {
  for (const l of lines(text).slice(0, 8)) {
    if (l.length < 5 || l.length > 40) continue;
    if (NAME_NOISE.test(l)) continue;
    if (/\d/.test(l)) continue;
    const words = l.split(/\s+/);
    if (words.length < 2 || words.length > 4) continue;
    const cap = words.filter(
      (w) => /^[A-Z][a-z'’.]+$/.test(w) || /^[A-Z]{2,}$/.test(w)
    );
    if (cap.length === words.length) return titleCase(l);
  }
  return '';
}

function pickName(perDoc: string[][]): string {
  // vote by normalised spelling (handles OCR variants across docs)
  const votes = new Map<string, { name: string; count: number }>();
  for (const cands of perDoc) {
    for (const n of cands) {
      const key = n.toUpperCase().replace(/[^A-Z ]/g, '').replace(/\s+/g, '');
      const cur = votes.get(key);
      if (cur) cur.count++;
      else votes.set(key, { name: n, count: 1 });
    }
  }
  let best: { name: string; count: number } | null = null;
  for (const v of votes.values()) {
    if (!best || v.count > best.count) best = v;
  }
  return best?.name ?? '';
}

/* ------------------------------------------------------------------ */
/* Education                                                           */
/* ------------------------------------------------------------------ */

const DEGREE_RES: { re: RegExp; degree: string }[] = [
  { re: /\bph\.?\s?d\b|doctor of philosophy/i, degree: 'Ph.D' },
  { re: /\bm\.?\s?tech\b|\bmtech\b|master of technology/i, degree: 'M.Tech' },
  { re: /\bm\.e\.(?!\w)|master of engineering/i, degree: 'M.E.' },
  { re: /\bmba\b|master of business administration/i, degree: 'MBA' },
  { re: /\bm\.?\s?sc\b|\bmsc\b|master of science/i, degree: 'M.Sc' },
  { re: /\bmca\b|master of computer applications/i, degree: 'MCA' },
  { re: /\bm\.?\s?com\b|master of commerce/i, degree: 'M.Com' },
  { re: /\bmbbs\b/i, degree: 'MBBS' },
  { re: /\bb\.?\s?tech\b|\bbtech\b|bachelor of technology/i, degree: 'B.Tech' },
  { re: /\bb\.e\.(?!\w)|bachelor of engineering/i, degree: 'B.E.' },
  { re: /\bb\.?\s?sc\b|\bbsc\b|bachelor of science/i, degree: 'B.Sc' },
  { re: /\bbba\b|bachelor of business administration/i, degree: 'BBA' },
  { re: /\bbca\b|bachelor of computer applications/i, degree: 'BCA' },
  { re: /\bb\.?\s?com\b|bachelor of commerce/i, degree: 'B.Com' },
  { re: /\bb\.a\.(?!\w)|bachelor of arts/i, degree: 'B.A.' },
  { re: /\bllb\b/i, degree: 'LLB' },
  {
    re: /\bsenior school certificate\b|\bsenior secondary\b|\bhigher secondary\b|\bhsc\b|\bintermediate\b|\bclass\s*xii\b|\b12th\b|\bplus two\b|\bxii\b(?!\w)/i,
    degree: 'Class XII',
  },
  {
    re: /\bsecondary school\b|\bsecondary school certificate\b|\bclass\s*x\b|\b10th\b|\bssc\b|\bmatriculation\b|\bhigh school\b|\bcbse\b|\bicse\b/i,
    degree: 'Class X',
  },
];

const INSTITUTION_RE =
  /\b(university|institute|institution|college|school|academy|vidyalaya|vidya|iit|nit|iiit|bits|polytechnic|convent|mahavidyalaya|vishwavidyalaya|board|campus|faculty)\b/i;
const YEAR_RE = /\b(19[89]\d|20[0-4]\d)\b/;
const YEAR_RANGE_RE =
  /\b(19[89]\d|20[0-4]\d)\s*[-–—\/to]{1,3}\s*(19[89]\d|20[0-4]\d|present)/i;
const BATCH_RE = /\bbatch\s*[:.\-–]?\s*(19[89]\d|20[0-4]\d)\s*[-–—]\s*(\d{2,4})/i;
const PASSING_YEAR_RE =
  /(?:year of passing|passing year|year of completion|completed in|passed in|session)\s*[:.\-–]?\s*(19[89]\d|20[0-4]\d)/i;

// Strong grades — unambiguous result indicators safe for whole-doc fallback
const GRADE_STRONG_RES: { re: RegExp; fmt: (m: RegExpExecArray) => string }[] = [
  {
    re: /(?:c\.?g\.?p\.?a|g\.?p\.?a|s\.?g\.?p\.?a|cpi)\s*[:=\-–]?\s*(\d{1,2}\.?\d{0,2})/i,
    fmt: (m) => `${m[1]} CGPA`,
  },
  {
    re: /\b(first class with distinction|distinction|first class|first division|second division)\b/i,
    fmt: (m) => titleCase(m[1]),
  },
  {
    re: /\bresult\s*[:.\-–]?\s*(pass(?:ed)?|fail(?:ed)?)\b/i,
    fmt: (m) => titleCase(m[1]),
  },
];
// Weak grades — a bare % only counts next to aggregate/total/result wording
const GRADE_WEAK_RES: { re: RegExp; fmt: (m: RegExpExecArray) => string }[] = [
  {
    re: /(?:aggregate|overall|total|percentage|percent|result|score|obtained)\D{0,30}?(\d{1,3}(?:\.\d{1,2})?)\s*%/i,
    fmt: (m) => `${m[1]}%`,
  },
  {
    re: /(\d{1,3}(?:\.\d{1,2})?)\s*%\s*(?:aggregate|overall|marks|score|result|obtained)/i,
    fmt: (m) => `${m[1]}%`,
  },
];

function gradeText(s: string): string {
  for (const g of [...GRADE_STRONG_RES, ...GRADE_WEAK_RES]) {
    const m = g.re.exec(s);
    if (m) return g.fmt(m);
  }
  return '';
}

/** Doc-level grade — strong indicators only, never stray subject percentages. */
function gradeDoc(text: string): string {
  for (const g of GRADE_STRONG_RES) {
    const m = g.re.exec(text);
    if (m) return g.fmt(m);
  }
  for (const g of GRADE_WEAK_RES) {
    const m = g.re.exec(text);
    if (m) return g.fmt(m);
  }
  return '';
}

// 2-letter branch codes only count when parenthesised — "(EC)", "(CSE)" —
// bare "it"/"me"/"ce" are common English words.
const PAREN_CODE_RES: { re: RegExp; field: string }[] = [
  { re: /\(\s*(cse|cs)\s*\)/i, field: 'Computer Science' },
  { re: /\(\s*it\s*\)/i, field: 'Information Technology' },
  { re: /\(\s*(ece?|ec)\s*\)/i, field: 'Electronics & Communication' },
  { re: /\(\s*(eee|ee)\s*\)/i, field: 'Electrical Engineering' },
  { re: /\(\s*me\s*\)/i, field: 'Mechanical Engineering' },
  { re: /\(\s*ce\s*\)/i, field: 'Civil Engineering' },
  { re: /\(\s*bt\s*\)/i, field: 'Biotechnology' },
  { re: /\(\s*ai\s*\)/i, field: 'Artificial Intelligence' },
  { re: /\(\s*ae\s*\)/i, field: 'Aeronautical Engineering' },
];

const FIELD_RES: { re: RegExp; field: string }[] = [
  { re: /computer science( and engineering)?|computer engineering/i, field: 'Computer Science' },
  { re: /information technology/i, field: 'Information Technology' },
  { re: /electronics (?:and|&) communication/i, field: 'Electronics & Communication' },
  { re: /electrical (?:and|&) electronics|electrical engineering/i, field: 'Electrical Engineering' },
  { re: /mechanical engineering/i, field: 'Mechanical Engineering' },
  { re: /civil engineering/i, field: 'Civil Engineering' },
  { re: /chemical engineering/i, field: 'Chemical Engineering' },
  { re: /biotechnology/i, field: 'Biotechnology' },
  { re: /artificial intelligence/i, field: 'Artificial Intelligence' },
  { re: /data science/i, field: 'Data Science' },
  { re: /business administration/i, field: 'Business Administration' },
  { re: /commerce/i, field: 'Commerce' },
  { re: /physics/i, field: 'Physics' },
  { re: /chemistry/i, field: 'Chemistry' },
  { re: /mathematics/i, field: 'Mathematics' },
  { re: /economics/i, field: 'Economics' },
  { re: /finance/i, field: 'Finance' },
  { re: /marketing/i, field: 'Marketing' },
  { re: /english/i, field: 'English' },
  { re: /biology/i, field: 'Biology' },
];

const FIELD_GENERIC_RE =
  /\bin\s+([a-z]+(?:\s+[a-z&]+){0,2}\s+(?:engineering|science|arts|commerce|technology|management|studies|design|architecture|pharmacy|law))\b/i;

const LABEL_STRIP_RE = /^[a-z ()'’]+\s*[:.\-–]\s*/;
// "NAME OF INSTITUTION : X", "School : X", "College/Institution - X" (Indian)
const INST_NAMED_RE =
  /(?:name\s+of\s+)?(?:the\s+)?(?:institution|institute|college|school|university|academy|vidyalaya|polytechnic)\s*[:.\-–]+\s*[^\w]{0,3}\s*([A-Z][A-Za-z ,.&'’-]{4,90})/i;
// "School08624 CENTRAL HINDU BOYS...", "SchooPB&24 X" — label mangled
// into a code by OCR, then the name
const INST_FUSED_RE =
  /\b(?:school|schoo|schl|college|instit?\w*|inst|academy|vidyalaya|polytechnic|vedio)[\w&.:–\-]{0,10}\s+([A-Z][A-Z .,&'’()-]{6,90})/i;

const SPECIFIC_INST_RE =
  /university|institute|college|school|academy|vidyalaya|polytechnic|mahavidyalaya/i;
// lines that look institutional but are exam/board labels, not the school
const NOT_INST_LINE =
  /examination|exam\b|statement of marks|marks statement|grade card|result|roll|session|senior school|secondary school|school-based|evaluation|assessment|scheme of|judging|instruction|pedagogy|co-scholastic|grading|affiliation|s\.?no\.?|if found|please return|must be carried|identity card|report loss|duplicate|holder at|carried by|loss of|return to|property of|board of secondary|board of education|central board|state board/i;
// boilerplate/notes lines that must never spawn an education entry
const EDU_NOISE_LINE =
  /school-based|evaluation|assessment|scheme of|judging|instruction|pedagogy|co-scholastic|grading|note\s*:|abbreviat|general/i;
// a line that IS just an institution name (no label needed)
const BARE_INST_LINE_RE =
  /^[^\w]{0,6}\s*([A-Z][A-Za-z .,&'’()-]{6,90}(?:University|Institute|Institution|College|School|Academy|Vidyalaya|Polytechnic|Mahavidyalaya|Convent)[A-Za-z .,&'’()-]{0,30})\s*[^\w]{0,6}$/i;

// trailing city/region on an institution name — "…, Greater Noida", "…Varanasi UP"
const INST_TAIL_CITY_RE =
  /\s+(?:greater noida|noida|delhi|new delhi|varanasi|pune|mumbai|chennai|kolkata|hyderabad|bengaluru|bangalore|lucknow|kanpur|patna|jaipur|bhopal|indore|nagpur|surat|vadodara|agra|meerut|allahabad|prayagraj|chandigarh|coimbatore|kochi|mysore|mysuru|dehradun|ranchi|raipur|guwahati|bhubaneswar|amritsar|ludhiana|jalandhar|g\.?\s?b\.?\s?nagar|u\.?\s?p\.?|india)\b.*$/i;

function cleanInstitution(raw: string): string {
  let s = raw
    .replace(LABEL_STRIP_RE, '')
    .replace(/^[^\w]+/, '')
    .trim();
  // prefer the run of text ending in an institution-type word
  const m = /([A-Z][A-Za-z .,&'’-]{1,80}?(?:University|Institute|Institution|College|School|Academy|Vidyalaya|Polytechnic|Convent|Mahavidyalaya|Board|Technolog\w*|Managem\w*|Engineering)[A-Za-z .,&'’-]{0,40})/i.exec(
    s
  );
  if (m) s = m[1];
  s = s.replace(INST_TAIL_CITY_RE, '').trim();
  s = s.replace(/,\s*[A-Z][A-Z ]{0,18}$/, ''); // ", GREATER NOI" tail cut mid-word
  s = s.replace(/[.,\s]+$/, '');
  // interior OCR fragments like "& I el" between real words
  s = s.replace(/\s+I{1,4}\s+[a-z]{1,3}\s+/g, ' ');
  // drop dangling connectors and OCR fragments at the cut edge
  let prev = '';
  while (prev !== s) {
    prev = s;
    s = s.replace(/\s+(of|and|the|&|,|for|de|di|in|at|el|la|I)$/i, '').trim();
  }
  if (s.length > 70) s = s.slice(0, 70).replace(/\s+\S*$/, '').trim();
  s = s.replace(/\s+/g, ' ');
  // ALL-CAPS institutions read better title-cased (known acronyms stay caps)
  const ACRONYMS = new Set(['BHU', 'IIT', 'NIT', 'IIIT', 'IIM', 'AIIMS', 'SSS', 'DAV', 'KV', 'JNV', 'CBSE', 'ICSE', 'UP', 'GL', 'GLB', 'BIT', 'MIT', 'IIIT', 'TIET', 'SRM', 'VIT', 'LPU', 'AMU', 'JMI', 'IP']);
  if (/^[A-Z0-9 .,&'’()-]+$/.test(s) && /[A-Z]{3}/.test(s)) {
    s = s
      .split(' ')
      .map((w) => {
        const bare = w.replace(/[^A-Z]/g, '');
        if (ACRONYMS.has(bare)) return w;
        if (/^[A-Z]{3,}$/.test(w) || /^[A-Z]{3,}[.,]$/.test(w))
          return titleCase(w);
        return w;
      })
      .join(' ')
      .replace(/\b(OF|AND|THE|IN|FOR|DE|DI|AT)\b/g, (m) => m.toLowerCase());
  }
  return s;
}

function instScore(inst: string): number {
  return (SPECIFIC_INST_RE.test(inst) ? 2 : 0) + Math.min(inst.length / 40, 1);
}

/** Institution candidates in a doc, best first. */
function docInstitutions(text: string): string[] {
  const cands: { inst: string; score: number }[] = [];
  const ls = lines(text);
  ls.forEach((l, i) => {
    let m = INST_NAMED_RE.exec(l) ?? INST_FUSED_RE.exec(l);
    let bonus = 1.5;
    if (!m) {
      m = BARE_INST_LINE_RE.exec(l);
      bonus = 0;
    }
    if (!m) return;
    let raw = m[1];
    // institution names often wrap onto the next line ("…& I" / "…of Tech. &")
    if (/(&|,|\bof\b|\band\b|\bI{1,4}|&\s*\w{0,6}|\w{1,3})$/i.test(raw.trim()) && ls[i + 1]) {
      const next = ls[i + 1];
      if (/^[A-Z]/.test(next.trim())) raw = raw + ' ' + next;
    }
    if (NOT_INST_LINE.test(raw)) return;
    const inst = cleanInstitution(raw);
    if (inst && inst.length >= 8) {
      cands.push({ inst, score: instScore(inst) + bonus });
    }
  });
  return cands.sort((a, b) => b.score - a.score).map((c) => c.inst);
}

function extractEducation(text: string): Education[] {
  const result: Education[] = [];
  const ls = lines(text);
  const byDegree = new Map<string, Education>();

  const docInsts = docInstitutions(text);
  const docYear = PASSING_YEAR_RE.exec(text)?.[1];
  const docGrade = gradeDoc(text);
  const marksheetish =
    /marksheet|mark sheet|statement of marks|grade card|marks obtained|sgpa|cgpa|examination|board of|semester/i.test(
      text
    );

  ls.forEach((line, i) => {
    if (EDU_NOISE_LINE.test(line)) return;
    const degreeHit = DEGREE_RES.find((d) => d.re.test(line));
    if (!degreeHit) return;

    const ctx = [ls[i - 1], line, ls[i + 1]].filter(Boolean).join(' | ');
    // institution: labelled lines in ±2 lines, preferring the named-label kind
    let institution = '';
    for (const j of [i, i - 1, i + 1, i - 2, i + 2]) {
      const cand = ls[j];
      if (!cand || NOT_INST_LINE.test(cand)) continue;
      const m = INST_NAMED_RE.exec(cand) ?? INST_FUSED_RE.exec(cand);
      if (m) {
        institution = cleanInstitution(m[1]);
        break;
      }
      if (INSTITUTION_RE.test(cand) && cand.length > 15 && !/examination|statement|subject|marks|result|grade|name|roll|date|board of secondary/i.test(cand)) {
        institution = cleanInstitution(cand);
        break;
      }
    }

    const range = YEAR_RANGE_RE.exec(ctx) ?? (BATCH_RE.exec(ctx) as RegExpExecArray | null);
    const year = YEAR_RE.exec(ctx);
    const grade = gradeText(ctx);
    const field =
      FIELD_RES.find((f) => f.re.test(ctx))?.field ??
      PAREN_CODE_RES.find((f) => f.re.test(ctx))?.field ??
      FIELD_GENERIC_RE.exec(line)?.[1] ??
      '';

    // Evidence check: a bare "B.E." in OCR garbage shouldn't create an entry
    const hasEvidence =
      institution ||
      range ||
      year ||
      field ||
      /bachelor|master|class|school|diploma|exam|ph\.?d|mba|mbbs|btech|mtech/i.test(line);
    if (!hasEvidence) return;

    const end = range
      ? range[2].toLowerCase() === 'present'
        ? 'Present'
        : range[2].length === 2
          ? '20' + range[2]
          : range[2]
      : year?.[0] ?? '';

    const existing = byDegree.get(degreeHit.degree);
    if (existing) {
      if (instScore(institution) > instScore(existing.institution))
        existing.institution = institution;
      existing.startYear ||= range?.[1] ?? '';
      existing.endYear ||= end;
      existing.grade ||= grade;
      existing.field ||= field ? titleCase(field) : '';
      return;
    }

    const entry: Education = {
      id: uid(),
      institution,
      degree: degreeHit.degree,
      field: field ? titleCase(field) : '',
      startYear: range?.[1] ?? '',
      endYear: end,
      grade,
    };
    byDegree.set(degreeHit.degree, entry);
    result.push(entry);
  });

  // Marksheet-style docs describe a single credential spread across many
  // lines — fill remaining blanks from document-level labelled fields.
  if (marksheetish || result.length === 1) {
    for (const e of result) {
      if (!e.institution && docInsts.length) e.institution = docInsts[0];
      if (!e.endYear && docYear) e.endYear = docYear;
      if (!e.grade && docGrade) e.grade = docGrade;
    }
  }

  return result;
}

/* ------------------------------------------------------------------ */
/* Certifications                                                      */
/* ------------------------------------------------------------------ */

const ISSUERS = [
  'Coursera', 'Udemy', 'NPTEL', 'edX', 'Udacity', 'Pluralsight', 'Google',
  'AWS', 'Amazon', 'Microsoft', 'Azure', 'IBM', 'Meta', 'Oracle', 'Cisco',
  'HackerRank', 'freeCodeCamp', 'LinkedIn', 'Kaggle', 'Salesforce', 'Adobe',
  'Autodesk', 'Infosys', 'TCS', 'Wipro', 'Accenture', 'Great Learning',
  'Simplilearn', 'upGrad', 'Stanford', 'MIT', 'IIT', 'NIELIT', 'Internshala',
  'Scaler', 'Coding Ninjas', 'GeeksforGeeks', 'Cognizant', 'Deloitte', 'ICEIT',
];
const ISSUER_RE = new RegExp(`\\b(${ISSUERS.map(escapeRe).join('|')})\\b`, 'i');
const CERT_LINE_RE =
  /\b(certificat|certified|certification|credential|badge|nano degree|nanodegree|course completion|completion of|successfully completed|course on|course in|training in|training on|summer training|winter training|membership|associate member|fellow)\w*/i;
const CERT_NOISE = /\b(marksheet|mark sheet|statement of marks|grade card|transcript|birth|death|marriage|caste|income|domicile|character|medical|transfer|migration|bonafide|school leaving|marks obtained|identity card|passbook|account|pan card|voter|election|aadhar|aadhaar|passport|licen[cs]e|registration no|customer id)\b/i;
const CERT_SKIP_LINE =
  /^(?:linkedin|github|e-?mail|phone|mob|address|website|contact|www\.|https?|date|place|signature|seal|registr|account|branch|ifsc|customer)/i;
// exam/board certificates are EDUCATION, not certifications
const EDU_CERT_RE =
  /\b(senior school|secondary school|high school|school certificate|certificate examination|board of|marks statement|class\s*x|class\s*xii|senior school certificate|secondary school certificate|all india|cbse|icse|state board|matriculation|intermediate|hsc|ssc)\b/i;
const CERT_HEADER_RE =
  /^(?:certificate\s+(of\s+)?(completion|appreciation|achievement|participation|excellence|merit|attendance|training|recognition|honou?r|membership)|[a-z ]{2,30}\s+certificate)\b\.?$/i;
const CERT_CONNECTIVE_RE =
  /^(?:this is to certify|it is certified|has (successfully )?completed|have (successfully )?completed|for (successfully )?completing|in recognition|offered by|conducted by|organized by|organised by|held on|in the year|during the|we are pleased|we hereby|proudly present|is awarded|hereby awarded|is admitted|admitted|enrolled|awarded|conferred|presented|granted)/i;
// a line that is just a URL or contact info
const URL_ONLY_RE = /^[^\w]{0,5}\s*(?:www\.|https?:\/\/)\S+\s*[^\w]{0,5}$/i;
// cert names shouldn't contain id numbers, signatures or digit runs
const CERT_NAME_BAD_RE =
  /\b(no\.?|number|signature|president|secretary|chairman|registrar|director|dated|seal|place)\b|\d{2,}|[^\x00-\x7F]{3,}/i;

const CERT_CONNECTIVE_WORDS = new Set([
  'a', 'an', 'the', 'for', 'of', 'in', 'on', 'at', 'has', 'have', 'had',
  'successfully', 'completed', 'attended', 'participated', 'undergone',
  'underwent', 'pursued', 'held', 'conducted', 'organized', 'organised',
  'offered', 'and', 'or', 'to', 'from', 'by', 'we', 'our', 'they', 'he',
  'she', 'his', 'her', 'their', 'its', 'this', 'that', 'is', 'was', 'were',
  'as', 'xe', 'mr', 'mrs', 'ms', 'shri', 'smt', 'sri', 'kum', 'dr',
]);

const CERT_NAME_NOISE_START =
  /^(?:this|that|has|have|the|a|an|in|of|for|to|from|by|on|at|is|was|were|we|he|she|it|and|or|with|offered|conducted|organized|held|during|year|dated?|certificat\w+|completion|course|roll|mr|ms|shri|smt|xe)\b/i;

function stripConnectives(name: string): string {
  const words = name.split(/\s+/);
  let changed = true;
  while (changed && words.length) {
    changed = false;
    if (CERT_CONNECTIVE_WORDS.has(words[0].toLowerCase().replace(/[’']/g, ''))) {
      words.shift();
      changed = true;
    }
  }
  return words.join(' ');
}

function canonicalIssuer(match: string): string {
  return (
    ISSUERS.find((i) => i.toLowerCase() === match.toLowerCase()) ??
    titleCase(match)
  );
}

function extractCertifications(text: string): Certification[] {
  const out: Certification[] = [];
  const seen = new Set<string>();
  const ls = lines(text);

  ls.forEach((l, i) => {
    if (l.length < 10 || l.length > 220) return;
    if (CERT_SKIP_LINE.test(l) || CERT_HEADER_RE.test(l)) return;
    if (URL_ONLY_RE.test(l)) return;
    if (CERT_NOISE.test(l)) return;
    if (EDU_CERT_RE.test(l)) return; // board certificates → education

    const isCertLine = CERT_LINE_RE.test(l);
    const issuerHere = ISSUER_RE.exec(l)?.[1] ?? '';
    if (!isCertLine && !issuerHere) return;

    const connective = CERT_CONNECTIVE_RE.test(l);
    const frag = /([A-Z][A-Za-z0-9 +#.\-:&/()]{5,90}(?:course|certification|certificate|program|training|specialization|nanodegree|bootcamp|workshop|membership|member))/i.exec(
      l
    );
    // connective/opening lines and issuer-only mentions only contribute
    // their embedded name fragment — never the raw line
    if (!frag && (connective || !isCertLine)) return;

    let name = frag
      ? frag[1].trim()
      : l
          .replace(/^(this is to )?certif\w+ (that|of|for)\s*/i, '')
          .replace(/\s{2,}/g, ' ')
          .trim();
    name = stripConnectives(name);
    // drop leading lowercase/punctuation junk ("admitted os an X" → "X")
    name = name.replace(/^(?:(?:[^\w]+|[a-z][a-z'’-]*)\s+)+/, '');
    if (name.length > 90) name = name.slice(0, 90).trim();
    name = name.replace(/[.\s]+$/, '');
    if (name.length < 8 || CERT_NAME_NOISE_START.test(name)) return;
    if (CERT_NAME_BAD_RE.test(name)) return;

    const ctx = [l, ls[i + 1], ls[i + 2], ls[i + 3], ls[i - 1]].filter(Boolean).join(' ');
    const issuer = ISSUER_RE.exec(ctx)?.[1] ?? '';
    const year = YEAR_RE.exec(ctx)?.[0] ?? '';
    const key = `${name.toLowerCase()}|${issuer.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id: uid(), name, issuer: issuer ? canonicalIssuer(issuer) : '', year });
  });
  return out.slice(0, 12);
}

/* ------------------------------------------------------------------ */
/* Experience                                                          */
/* ------------------------------------------------------------------ */

const ROLE_RE =
  /\b(intern|internship|engineer|developer|analyst|designer|manager|consultant|associate|executive|officer|scientist|researcher|lead|head|director|coordinator|trainee|apprentice|freelance|volunteer|teacher|professor|accountant|administrator|training|member|member of)\b/i;
const COMPANY_LEGAL_RE =
  /\b([A-Z][A-Za-z0-9 &.,'’-]{2,60}(?:Pvt\.?\s?Ltd\.?|Private Limited|Ltd\.?|LLP|LLC|Inc\.?|Corporation|Corp\.?))\b/;
const COMPANY_BIZ_RE =
  /\b([A-Z][A-Za-z0-9 &.,'’-]{2,60}?(?:Technologies|Technology|Solutions|Systems|Labs|Industries|Enterprises|Group|Services|Infotech|InfoTech|Softwares?|Consulting|Consultancy|Startup|University|Institute|Institution|College|School))\b/;

/** Legal-suffix company names beat generic business words — search the
 *  whole window for a legal name before accepting a business-word one. */
function companyNear(ls: string[], i: number): RegExpExecArray | null {
  let biz: RegExpExecArray | null = null;
  for (const j of [i, i + 1, i + 2, i + 3, i + 4, i - 1, i - 2]) {
    const l = ls[j];
    if (!l) continue;
    const legal = COMPANY_LEGAL_RE.exec(l);
    if (legal) return legal;
    if (!biz) biz = COMPANY_BIZ_RE.exec(l);
  }
  return biz;
}

const DATE_PART = String.raw`(?:\d{1,2}\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*,?\s*(?:19|20)\d{2}|(?:19|20)\d{2}`;
const DATE_RANGE_RE = new RegExp(
  `(${DATE_PART})\\s*[-–—to]{1,4}\\s*(${DATE_PART}|present|current|till date)`,
  'i'
);

const MODIFIER_WORDS =
  /((?:senior|junior|sr\.?|jr\.?|principal|software|web|frontend|front-end|backend|back-end|full[\s-]?stack|data|machine learning|ml|ai|cloud|devops|qa|sales|marketing|hr|operations|business|graphic|content|research|teaching|summer|winter|technical|product|project|program|finance|it|support|system|network|security|intern|internship|engineer|developer|analyst|designer|manager|consultant|associate|executive|officer|scientist|researcher|director|coordinator|trainee|apprentice|teacher|professor|accountant|administrator|training|one|two|three|four|five|six|weeks?|days?|months?)\s+){0,3}$/i;

function extractExperience(text: string): Experience[] {
  const out: Experience[] = [];
  const seen = new Set<string>();
  const ls = lines(text);

  ls.forEach((l, i) => {
    if (l.length < 8 || l.length > 250) return;
    const hasRole = ROLE_RE.test(l);
    let dates: RegExpExecArray | null = null;
    for (const j of [i, i + 1, i + 2, i + 3, i + 4, i + 5, i - 1]) {
      dates = DATE_RANGE_RE.exec(ls[j] ?? '');
      if (dates) break;
    }
    const company = companyNear(ls, i);
    if (!hasRole || (!dates && !company)) return;
    // signature blocks ("IH Director", "Registrar") aren't jobs
    const words = l.replace(/[^\w ]/g, ' ').trim().split(/\s+/);
    if (words.length <= 2) return;
    if (/marksheet|grade card|semester|cgpa|marks obtained|result|subject/i.test(l))
      return;

    // take the LAST role word on the line, collecting modifiers before it
    const roleWords = [
      ...l.matchAll(
        /\b(intern|internship|engineer|developer|analyst|designer|manager|consultant|associate|executive|officer|scientist|researcher|lead|head|director|coordinator|trainee|apprentice|teacher|professor|accountant|administrator|training|member)\w*/gi
      ),
    ];
    let role = '';
    for (const m of roleWords) {
      const before = l.slice(Math.max(0, (m.index ?? 0) - 60), m.index ?? 0);
      const mods = MODIFIER_WORDS.exec(before)?.[0] ?? '';
      role = titleCase((mods + m[0]).trim());
    }
    if (!role) return;

    const key = `${role.toLowerCase()}|${(company?.[1] ?? '').toLowerCase()}|${dates?.[1] ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);

    out.push({
      id: uid(),
      company: company?.[1]?.trim() ?? '',
      role,
      startDate: dates?.[1]?.trim() ?? '',
      endDate: dates?.[2]?.trim() ?? '',
      description: '',
    });
  });
  return out.slice(0, 8);
}

/* ------------------------------------------------------------------ */
/* Projects, achievements, skills, languages                           */
/* ------------------------------------------------------------------ */

const PROJ_LABEL_RE = /\bprojects?(?:\s+title|\s+name)?\s*[:.\-–]\s*(.{4,90})/i;
const PROJ_USING_RE =
  /\b[Pp]roject\s+(?:using|with|built on|based on|in)\s+([A-Za-z0-9 +#.,&/()'-]{4,90})/;
const PROJ_INLINE_RE =
  /\b[Pp]roject\s+(?:on|called|named|titled)\s+([A-Z][A-Za-z0-9 +#.\-:&/()]{4,80})/;
const PROJ_VERB_RE =
  /(?:developed|developing|built|building|created|creating|designed|designing|implemented|implementing)\s*(?:a|an|the)?\s*([A-Za-z0-9 +#.\-:&/()]{8,80})?/i;
const PROJ_CONNECTIVE_RE =
  /^(?:a|an|the|using|with|in|on|of|for|to|based on|that|which|an? app|application|system|platform|website|tool)\s+/i;
const PROJ_NAME_LINE_RE = /^[A-Z][\w .:&()/'+-]{2,60}$/;
const PROJ_NAME_NOISE =
  /certif|award|winner|prize|hackathon|marksheet|result|candidate|name|date|subject|marks|roll|exam/i;

function nameishLine(l: string | undefined): string {
  if (!l) return '';
  const s = l.trim();
  if (PROJ_NAME_NOISE.test(s)) return '';
  return PROJ_NAME_LINE_RE.test(s) ? s : '';
}

function pushProject(
  out: Project[],
  seen: Set<string>,
  name: string,
  tech: string
) {
  name = name.replace(/[.,\s]+$/, '').trim();
  if (name.length < 4 || out.length >= 6) return;
  const key = name.toLowerCase().slice(0, 40);
  if (seen.has(key)) {
    const existing = out.find((p) => p.name.toLowerCase().slice(0, 40) === key);
    if (existing && !existing.tech && tech)
      existing.tech = tech.replace(/[.,\s]+$/, '');
    return;
  }
  seen.add(key);
  out.push({ id: uid(), name, description: '', tech: tech.replace(/[.,\s]+$/, '') });
}

function extractProjects(text: string): Project[] {
  const out: Project[] = [];
  const seen = new Set<string>();
  const ls = lines(text);

  ls.forEach((l, i) => {
    if (l.length < 15 || l.length > 200 || out.length >= 6) return;

    const using = PROJ_USING_RE.exec(l);
    if (using) {
      const name =
        nameishLine(ls[i - 1]) || nameishLine(ls[i - 2]) || nameishLine(ls[i + 1]);
      if (name) pushProject(out, seen, name, using[1]);
      return;
    }

    const labelled = PROJ_LABEL_RE.exec(l);
    if (labelled) {
      let name = labelled[1].replace(/\s{2,}/g, ' ').trim();
      if (PROJ_CONNECTIVE_RE.test(name)) {
        const tech = name.replace(PROJ_CONNECTIVE_RE, '');
        name = nameishLine(ls[i - 1]) || nameishLine(ls[i - 2]);
        if (!name) return;
        pushProject(out, seen, name, tech);
      } else {
        pushProject(out, seen, name, '');
      }
      return;
    }

    const inline = PROJ_INLINE_RE.exec(l);
    if (inline) {
      pushProject(out, seen, inline[1].replace(/\s{2,}/g, ' '), '');
      return;
    }

    const verb = PROJ_VERB_RE.exec(l);
    if (verb) {
      let name = (verb[1] ?? '').replace(/\s{2,}/g, ' ').trim();
      if (!name || PROJ_CONNECTIVE_RE.test(name)) {
        name = nameishLine(ls[i + 1]);
      }
      if (name) pushProject(out, seen, name, '');
    }
  });
  return out;
}

const ACHIEVE_RE =
  /\b(award|prize|winner|won|rank|runner[\s-]?up|scholarship|fellowship|medal|gold|silver|bronze|hackathon|olympiad|merit|distinction|topper|first place|second place|third place|secured|felicitation|recognition|best\s+\w+|finalist|champion|patent|published|publication|dean'?s list|gate\s+qualified|net\s+qualified)\b/i;

function extractAchievements(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const l of lines(text)) {
    if (l.length < 12 || l.length > 180) continue;
    if (!ACHIEVE_RE.test(l)) continue;
    if (CERT_NOISE.test(l)) continue;
    const clean = l
      .replace(LABEL_STRIP_RE, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[-•*·\d.)\s]+/, '')
      .trim();
    if (clean.length < 10) continue;
    const key = clean.toLowerCase().slice(0, 50);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= 8) break;
  }
  return out;
}

function extractSkills(text: string): string[] {
  const norm =
    ' ' +
    text
      .toLowerCase()
      .replace(URL_RE, ' ')
      .replace(/(?:[\w-]+\.)+(?:com|in|org|net|io|dev|edu|gov|co|ai)(?:\/\S*)?/gi, ' ')
      .replace(/(?:linked\s?in|github|gitlab|e-?mail|phone|mob(?:ile)?|address|website|portfolio|contact|father|mother)\s*[:.]/gi, ' ')
      .replace(EMAIL_ONE, ' ') +
    ' ';
  const found = new Set<string>();
  for (const [key, display] of Object.entries(SKILL_MAP)) {
    const re = new RegExp(`(?<![\\w+#])${escapeRe(key)}(?![\\w])`, 'i');
    if (re.test(norm)) found.add(display);
  }
  return [...found];
}

const LANGS = [
  'English', 'Hindi', 'Bengali', 'Telugu', 'Marathi', 'Tamil', 'Urdu', 'Gujarati',
  'Kannada', 'Odia', 'Malayalam', 'Punjabi', 'Assamese', 'Sanskrit', 'French',
  'German', 'Spanish', 'Japanese', 'Mandarin', 'Chinese', 'Korean', 'Arabic',
  'Portuguese', 'Russian', 'Italian', 'Dutch', 'Thai', 'Vietnamese', 'Nepali',
  'Bhojpuri', 'Maithili', 'Rajasthani', 'Konkani', 'Sindhi', 'Kashmiri', 'Dogri',
  'Manipuri', 'Bodo', 'Santhali', 'Tulu',
];
const LANG_RE = new RegExp(
  `\\b(${LANGS.join('|')})\\b\\s*(?:\\(?(?:native|fluent|intermediate|basic|proficient|bilingual|mother tongue)\\)?)?`,
  'gi'
);

function extractLanguages(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(LANG_RE)) {
    if (/\b(course|language of instruction|medium|subject)\b/i.test(m[0])) continue;
    found.add(titleCase(m[1]));
  }
  return [...found];
}

const CITY_RE =
  /\b(mumbai|delhi|new delhi|bengaluru|bangalore|hyderabad|chennai|kolkata|pune|ahmedabad|jaipur|lucknow|kanpur|nagpur|indore|bhopal|patna|surat|kochi|coimbatore|chandigarh|noida|greater noida|gurugram|gurgaon|thane|visakhapatnam|vadodara|guwahati|bhubaneswar|dehradun|ranchi|raipur|mysore|mysuru|mangalore|varanasi|agra|amritsar|ludhiana|jalandhar|meerut|allahabad|prayagraj|bareilly|aligarh|moradabad|gorakhpur|jhansi|gwalior|jabalpur|ujjain|saharanpur|nainital|ajmer|kota|udaipur|jodhpur|salem|tirunelveli|vellore|warangal|guntur|vijayawada|nellore|kurnool|rajkot|jamnagar|bhavnagar|jamshedpur|dhanbad|asansol|siliguri|aurangabad|nashik|solapur|kolhapur|sangli|amravati|akola|latur|dhule|jalgaon|chandrapur|parbhani|nanded|ahmednagar|chandauli|chanbauli|sakaldiha|new york|san francisco|los angeles|chicago|boston|seattle|austin|london|singapore|dubai|toronto|sydney|berlin|paris|amsterdam)\b/i;

function extractLocation(text: string): string {
  const labelled = /(?:address|location|residence|city|dist(?:rict)?)\s*[:.\-–]\s*([A-Za-z ,-]{3,60})/i.exec(text);
  if (labelled) {
    const city = CITY_RE.exec(labelled[1]);
    if (city) return titleCase(city[0]);
  }
  const city = CITY_RE.exec(text);
  return city ? titleCase(city[0]) : '';
}

/* ------------------------------------------------------------------ */
/* Document gating + merge                                             */
/* ------------------------------------------------------------------ */

// Credential-type docs feed resume sections; ID/bank docs only feed name/contact
const CREDENTIAL_DOC_RE =
  /examination|exam|marksheet|mark sheet|statement of marks|grade card|semester|university|college|school|bachelor|master|diploma|b\.?\s?tech|m\.?\s?tech|bachelor of|certificat|training|internship|experience|course|degree|grade|sgpa|cgpa|result|passed|transcript|membership|member|batch|program|roll no/i;

export function parseDocuments(texts: string[]): ResumeData {
  const resume = emptyResume();
  const norm = texts.map(normalise);

  const perDocNames: string[][] = [];
  for (const t of norm) {
    const email = extractEmail(t);
    if (email && !resume.email) resume.email = email;

    const phone = extractPhone(t);
    if (phone && !resume.phone) resume.phone = phone;

    if (!resume.linkedin || !resume.github || !resume.website) {
      const links = extractLinks(t);
      resume.linkedin ||= links.linkedin;
      resume.github ||= links.github;
      resume.website ||= links.website;
    }

    perDocNames.push(nameCandidates(t));
    if (!resume.location) resume.location = extractLocation(t);

    if (!CREDENTIAL_DOC_RE.test(t)) continue; // ID/bank docs → name/contact only

    for (const e of extractEducation(t)) {
      const dup = resume.education.find((x) => x.degree === e.degree);
      if (dup) {
        if (instScore(e.institution) > instScore(dup.institution))
          dup.institution = e.institution;
        dup.startYear ||= e.startYear;
        dup.endYear ||= e.endYear;
        dup.grade ||= e.grade;
        dup.field ||= e.field;
      } else {
        resume.education.push(e);
      }
    }
    for (const c of extractCertifications(t)) {
      if (
        !resume.certifications.some(
          (x) => x.name.toLowerCase() === c.name.toLowerCase() && x.issuer === c.issuer
        )
      )
        resume.certifications.push(c);
    }
    for (const x of extractExperience(t)) {
      if (
        !resume.experience.some(
          (e) => e.role === x.role && e.company === x.company && e.startDate === x.startDate
        )
      )
        resume.experience.push(x);
    }
    for (const p of extractProjects(t)) {
      if (!resume.projects.some((q) => q.name.toLowerCase() === p.name.toLowerCase()))
        resume.projects.push(p);
    }
    for (const a of extractAchievements(t)) {
      if (!resume.achievements.some((b) => b.toLowerCase() === a.toLowerCase()))
        resume.achievements.push(a);
    }
    for (const s of extractSkills(t)) {
      if (!resume.skills.includes(s)) resume.skills.push(s);
    }
    for (const l of extractLanguages(t)) {
      if (!resume.languages.includes(l)) resume.languages.push(l);
    }
  }

  resume.name = pickName(perDocNames);
  if (!resume.name) {
    for (const t of norm) {
      resume.name = guessNameFromLines(t);
      if (resume.name) break;
    }
  }

  const rank = (d: string) =>
    ['Ph.D', 'M.Tech', 'M.E.', 'MBA', 'M.Sc', 'MCA', 'M.Com', 'MBBS', 'B.Tech', 'B.E.', 'B.Sc', 'BBA', 'BCA', 'B.Com', 'B.A.', 'LLB', 'Class XII', 'Class X'].indexOf(d);
  resume.education.sort((a, b) => rank(a.degree) - rank(b.degree));

  const topEdu = resume.education[0];
  if (topEdu && !resume.title) {
    resume.title = topEdu.field
      ? `${topEdu.degree} in ${topEdu.field}`
      : `${topEdu.degree} Graduate`;
  }
  if (!resume.summary && (topEdu || resume.skills.length)) {
    const bits: string[] = [];
    if (topEdu) {
      bits.push(
        `${topEdu.degree}${topEdu.field ? ' in ' + topEdu.field : ''}${
          topEdu.institution ? ' from ' + topEdu.institution : ''
        }${topEdu.grade ? ` (${topEdu.grade})` : ''}`
      );
    }
    const skillStr = resume.skills.slice(0, 6).join(', ');
    resume.summary =
      `${bits.length ? `Completed ${bits[0]}. ` : ''}${
        skillStr ? `Skilled in ${skillStr}. ` : ''
      }${resume.certifications.length ? `Holds ${resume.certifications.length} certification${resume.certifications.length > 1 ? 's' : ''}.` : ''}`.trim();
  }

  return resume;
}
