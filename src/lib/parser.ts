/**
 * Heuristic parser that converts raw OCR/text-layer output from documents
 * (marksheets, certificates, IDs, CVs…) into structured resume data.
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
    .replace(/\b(Of|And|The|In|For|De|Di|Van|Von)\b/g, (m) => m.toLowerCase());
}

/* ------------------------------------------------------------------ */
/* Contact info                                                        */
/* ------------------------------------------------------------------ */

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_RE =
  /(?:\+?\d{1,3}[-\s]?)?(?:\(?\d{3,5}\)?[-\s]?)?\d{3,5}[-\s]?\d{4,6}/;
const LINKEDIN_RE = /(?:linkedin\.com\/in\/|linkedin\.com\/)[\w-]+/i;
const GITHUB_RE = /github\.com\/[\w-]+/i;
const URL_RE = /https?:\/\/[^\s)>"']+/gi;

function extractPhone(text: string): string {
  // Prefer labelled numbers, then standalone long digit runs
  const labelled =
    /(?:mobile|phone|contact|mob|tel|ph)\.?\s*(?:no\.?|number)?\s*[:.\-]?\s*([+\d][\d\s\-()]{7,16}\d)/i.exec(
      text
    );
  const candidate = labelled?.[1] ?? PHONE_RE.exec(text)?.[0];
  if (!candidate) return '';
  const digits = candidate.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return '';
  // strip common country code prefixes for display
  return '+' + digits.replace(/^0+/, '');
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
  website =
    all.find(
      (u) => !/linkedin|github|facebook|instagram|twitter|x\.com|youtube/i.test(u)
    ) ?? '';
  return { linkedin, github, website };
}

/* ------------------------------------------------------------------ */
/* Name                                                                */
/* ------------------------------------------------------------------ */

const NAME_LABEL_RE =
  /(?:candidate|student|applicant|trainee|participant|holder)?\s*name\s*[:.\-–]\s*([A-Za-z][A-Za-z .']{2,50})/i;
const CERT_NAME_RES = [
  /certify\s+that\s+(?:mr\.?|ms\.?|mrs\.?|shri|smt\.?|kum(?:ari)?\.?|dr\.?)?\s*([A-Z][A-Za-z .']{2,50})/i,
  /awarded\s+to\s+(?:mr\.?|ms\.?|mrs\.?|shri|smt\.?|kum(?:ari)?\.?|dr\.?)?\s*([A-Z][A-Za-z .']{2,50})/i,
  /presented\s+to\s+(?:mr\.?|ms\.?|mrs\.?|shri|smt\.?|kum(?:ari)?\.?|dr\.?)?\s*([A-Z][A-Za-z .']{2,50})/i,
  /conferred\s+(?:up)?on\s+(?:mr\.?|ms\.?|mrs\.?|shri|smt\.?|kum(?:ari)?\.?|dr\.?)?\s*([A-Z][A-Za-z .']{2,50})/i,
];

const NAME_NOISE =
  /\b(school|college|university|institute|board|certificate|marksheet|statement|grade|roll|exam|father|mother|guardian|course|program|project|team|company|address)\b/i;

function cleanName(raw: string): string {
  let n = raw
    .replace(/[^A-Za-z .']/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const words = n.split(' ').filter((w) => w.length > 1 || /^[A-Z]$/.test(w));
  if (words.length < 2) return '';
  n = words.slice(0, 4).join(' ');
  if (NAME_NOISE.test(n)) return '';
  return titleCase(n);
}

function extractName(text: string): string {
  const m = NAME_LABEL_RE.exec(text);
  if (m) {
    const n = cleanName(m[1]);
    if (n) return n;
  }
  for (const re of CERT_NAME_RES) {
    const cm = re.exec(text);
    if (cm) {
      const n = cleanName(cm[1]);
      if (n) return n;
    }
  }
  return '';
}

/** Fallback: first line that looks like a plain name (used if labelled search failed). */
function guessNameFromLines(text: string): string {
  for (const l of lines(text).slice(0, 8)) {
    if (l.length < 5 || l.length > 40) continue;
    if (NAME_NOISE.test(l)) continue;
    if (/\d/.test(l)) continue;
    const words = l.split(/\s+/);
    if (words.length < 2 || words.length > 4) continue;
    const capWords = words.filter((w) => /^[A-Z][a-z'’.]+$/.test(w) || /^[A-Z]{2,}$/.test(w));
    if (capWords.length === words.length) return titleCase(l);
  }
  return '';
}

/* ------------------------------------------------------------------ */
/* Education                                                           */
/* ------------------------------------------------------------------ */

const DEGREE_RES: { re: RegExp; degree: string; field?: string }[] = [
  { re: /\bph\.?\s?d\b/i, degree: 'Ph.D' },
  { re: /\bm\.?\s?tech\b|\bm\.?\s?e\b(?!\w)/i, degree: 'M.Tech' },
  { re: /\bmba\b|master of business administration/i, degree: 'MBA' },
  { re: /\bm\.?\s?sc\b|\bmsc\b|master of science/i, degree: 'M.Sc' },
  { re: /\bmca\b|master of computer applications/i, degree: 'MCA' },
  { re: /\bm\.?\s?com\b|master of commerce/i, degree: 'M.Com' },
  { re: /\bmbbs\b/i, degree: 'MBBS' },
  { re: /\bb\.?\s?tech\b|\bbtech\b|bachelor of technology/i, degree: 'B.Tech' },
  { re: /\bb\.?\s?e\b(?!\w)|bachelor of engineering/i, degree: 'B.E.' },
  { re: /\bb\.?\s?sc\b|\bbsc\b|bachelor of science/i, degree: 'B.Sc' },
  { re: /\bbba\b|bachelor of business administration/i, degree: 'BBA' },
  { re: /\bbca\b|bachelor of computer applications/i, degree: 'BCA' },
  { re: /\bb\.?\s?com\b|bachelor of commerce/i, degree: 'B.Com' },
  { re: /\bba\b(?!\w)|bachelor of arts/i, degree: 'B.A.' },
  { re: /\bllb\b/i, degree: 'LLB' },
  { re: /\bdiploma\b|\bpolytechnic\b/i, degree: 'Diploma' },
  {
    re: /\b(xii|12th|class\s*xii|hsc|intermediate|senior secondary|higher secondary|plus two)\b/i,
    degree: 'Class XII',
  },
  {
    re: /\b(10th|class\s*x|ssc|matriculation|secondary school|high school|cbse|icse)\b/i,
    degree: 'Class X',
  },
];

const INSTITUTION_RE =
  /\b(university|universitv|institute|institution|college|school|academy|vidyalaya|vidya|iit|nit|iiit|bits|polytechnic|convent|mahavidyalaya|vishwavidyalaya|board|campus|faculty)\b/i;
const YEAR_RE = /\b(19[89]\d|20[0-4]\d)\b/;
const YEAR_RANGE_RE = /\b(19[89]\d|20[0-4]\d)\s*[-–—to]{1,3}\s*(19[89]\d|20[0-4]\d|present)/i;
const GRADE_RES: { re: RegExp; fmt: (m: RegExpExecArray) => string }[] = [
  {
    re: /(?:c\.?g\.?p\.?a|g\.?p\.?a|s\.?g\.?p\.?a|cpi)\s*[:=\-–]?\s*(\d{1,2}\.?\d{0,2})/i,
    fmt: (m) => `${m[1]} CGPA`,
  },
  {
    re: /(\d{1,3}(?:\.\d{1,2})?)\s*(?:%|percent|percentage)/i,
    fmt: (m) => `${m[1]}%`,
  },
  {
    re: /\b(first class with distinction|distinction|first class|first division|second division)\b/i,
    fmt: (m) => titleCase(m[1]),
  },
];

function gradeText(s: string): string {
  for (const g of GRADE_RES) {
    const m = g.re.exec(s);
    if (m) return g.fmt(m);
  }
  return '';
}
const FIELD_RE =
  /(?:in|of)\s+(computer science|computer engineering|information technology|information science|electronics|electrical engineering|electronics and communication|electronics and telecommunication|mechanical|mechanical engineering|civil|civil engineering|chemical|chemical engineering|artificial intelligence|data science|business administration|commerce|arts|science|physics|chemistry|mathematics|biology|biotechnology|english|economics|finance|marketing|human resources)/i;
const FIELD_GENERIC_RE =
  /\bin\s+([a-z]+(?:\s+[a-z]+){0,2}\s+(?:engineering|science|arts|commerce|technology|management|studies|design|architecture|pharmacy|law))\b/i;

const LABEL_STRIP_RE = /^[a-z ()]+\s*[:.\-–]\s*/i;
const INST_LABEL_RE =
  /(?:institution|institute|college|school|university|board|academy|vidyalaya)\s*[:.\-–]\s*([A-Za-z ,.&'-]{4,80})/i;
const PASSING_YEAR_RE =
  /(?:year of passing|passing year|year of completion|completed in|passed in)\s*[:.\-–]?\s*(19[89]\d|20[0-4]\d)/i;

const SPECIFIC_INST_RE =
  /university|institute|college|school|academy|vidyalaya|polytechnic|mahavidyalaya/i;

function cleanInstitution(raw: string): string {
  let s = raw.replace(LABEL_STRIP_RE, '').trim();
  if (s.length > 70) {
    const m = /([A-Z][A-Za-z .,&'-]{8,66}(?:University|Institute|Institution|College|School|Academy|Vidyalaya|Polytechnic|Board)[A-Za-z .,&'-]{0,20})/i.exec(
      s
    );
    s = m ? m[1].trim() : s.slice(0, 70).trim();
  }
  return s.replace(/\s+/g, ' ');
}

function instScore(inst: string): number {
  return (SPECIFIC_INST_RE.test(inst) ? 2 : 0) + Math.min(inst.length / 40, 1);
}

function extractEducation(text: string): Education[] {
  const result: Education[] = [];
  const ls = lines(text);
  const byDegree = new Map<string, Education>();

  const docInst = INST_LABEL_RE.exec(text)?.[1];
  const docYear = PASSING_YEAR_RE.exec(text)?.[1];
  const docGrade = gradeText(text);
  const marksheetish =
    /marksheet|mark sheet|statement of marks|grade card|marks obtained|sgpa|cgpa|examination|board of/i.test(
      text
    );

  ls.forEach((line, i) => {
    const degreeHit = DEGREE_RES.find((d) => d.re.test(line));
    if (!degreeHit) return;

    const ctx = [ls[i - 1], line, ls[i + 1]].filter(Boolean).join(' | ');
    const instLine = [line, ls[i - 1], ls[i + 1]]
      .filter(Boolean)
      .find((l) => INSTITUTION_RE.test(l) && l.length > 15);

    const institution = instLine ? cleanInstitution(instLine) : '';
    const range = YEAR_RANGE_RE.exec(ctx);
    const year = YEAR_RE.exec(ctx);
    const grade = gradeText(ctx);
    const field =
      FIELD_RE.exec(ctx)?.[1] ?? FIELD_GENERIC_RE.exec(ctx)?.[1] ?? '';

    const existing = byDegree.get(degreeHit.degree);
    if (existing) {
      // Same degree mentioned twice in one doc — merge, keeping the
      // more specific institution and any fields the other lacks.
      if (instScore(institution) > instScore(existing.institution))
        existing.institution = institution;
      existing.startYear ||= range?.[1] ?? '';
      const end =
        (range ? (range[2].toLowerCase() === 'present' ? 'Present' : range[2]) : year?.[0]) ?? '';
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
      endYear: range
        ? range[2].toLowerCase() === 'present'
          ? 'Present'
          : range[2]
        : (year?.[0] ?? ''),
      grade,
    };
    byDegree.set(degreeHit.degree, entry);
    result.push(entry);
  });

  // Marksheet-style docs describe a single credential spread across many
  // lines — fill remaining blanks from document-level labelled fields.
  if (marksheetish || result.length === 1) {
    for (const e of result) {
      if (!e.institution && docInst) e.institution = cleanInstitution(docInst);
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
  'Scaler', 'Coding Ninjas', 'GeeksforGeeks', 'Cognizant', 'Deloitte',
];
const ISSUER_RE = new RegExp(`\\b(${ISSUERS.map(escapeRe).join('|')})\\b`, 'i');
const CERT_LINE_RE =
  /\b(certificat|certified|certification|credential|badge|nano degree|nanodegree|course completion|completion of|successfully completed|course on|course in|training in)\w*/i;
const CERT_NOISE = /\b(marksheet|mark sheet|statement of marks|grade card|transcript|birth|death|marriage|caste|income|domicile|character|medical|transfer|migration|bonafide|school leaving|marks obtained)\b/i;
const CERT_SKIP_LINE =
  /^(?:linkedin|github|e-?mail|phone|mob|address|website|contact|www\.|https?|date|place|signature|seal|registr)/i;
const CERT_HEADER_RE =
  /^(?:certificate\s+(of\s+)?(completion|appreciation|achievement|participation|excellence|merit|attendance|training|recognition|honou?r)|[a-z ]{2,30}\s+certificate)\b\.?$/i;
const CERT_CONNECTIVE_RE =
  /^(?:this is to certify|it is certified|has (successfully )?completed|have (successfully )?completed|for (successfully )?completing|in recognition|offered by|conducted by|organized by|organised by|held on|in the year|during the|we are pleased|we hereby|proudly present|is awarded|hereby awarded)/i;
const CERT_NAME_NOISE_START =
  /^(?:this|that|has|have|the|a|an|in|of|for|to|from|by|on|at|is|was|were|we|he|she|it|and|or|with|offered|conducted|organized|held|during|year|dated?|certificat\w+|completion|course)\b/i;

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
    if (CERT_NOISE.test(l)) return;

    const isCertLine = CERT_LINE_RE.test(l);
    const issuerHere = ISSUER_RE.exec(l)?.[1] ?? '';
    if (!isCertLine && !issuerHere) return;
    if (CERT_CONNECTIVE_RE.test(l)) return;

    let name = l
      .replace(/^(this is to )?certif\w+ (that|of|for)\s*/i, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    // pull a "X course/certification" fragment if the line is cluttered
    const frag = /([A-Z][A-Za-z0-9 +#.\-:&/()]{5,90}(?:course|certification|certificate|program|training|specialization|nanodegree|bootcamp|workshop|certified [a-z ]+))/i.exec(
      l
    );
    if (frag) name = frag[1].trim();
    if (name.length > 90) name = name.slice(0, 90).trim();
    name = name.replace(/[.\s]+$/, '');
    if (name.length < 8 || CERT_NAME_NOISE_START.test(name)) return;

    // issuer/year may live on adjacent lines ("offered by AWS", "in the year 2024")
    const ctx = [l, ls[i + 1], ls[i + 2], ls[i - 1]].filter(Boolean).join(' ');
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
  /\b(intern|internship|engineer|developer|analyst|designer|manager|consultant|associate|executive|officer|scientist|researcher|lead|head|director|coordinator|trainee|apprentice|freelance|volunteer|teacher|professor|accountant|administrator)\b/i;
const COMPANY_LEGAL_RE =
  /\b([A-Z][A-Za-z0-9 &.,'-]{2,60}(?:Pvt\.?\s?Ltd\.?|Private Limited|Ltd\.?|LLP|LLC|Inc\.?|Corporation|Corp\.?))\b/;
const COMPANY_BIZ_RE =
  /\b([A-Z][A-Za-z0-9 &.,'-]{2,60}?(?:Technologies|Technology|Solutions|Systems|Labs|Industries|Enterprises|Group|Services|Infotech|Softwares?|Consulting|Consultancy|Startup|University|Institute|College|School))\b/;

function companyIn(l: string | undefined): RegExpExecArray | null {
  if (!l) return null;
  return COMPANY_LEGAL_RE.exec(l) ?? COMPANY_BIZ_RE.exec(l);
}
const DATE_RANGE_RE =
  /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{4}|\d{4})\s*[-–—to]{1,3}\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{4}|\d{4}|present|current|till date)/i;

function extractExperience(text: string): Experience[] {
  const out: Experience[] = [];
  const seen = new Set<string>();
  const ls = lines(text);

  ls.forEach((l, i) => {
    if (l.length < 8 || l.length > 250) return;
    const hasRole = ROLE_RE.test(l);
    const dates = DATE_RANGE_RE.exec(l) ?? DATE_RANGE_RE.exec(ls[i + 1] ?? '');
    // letterhead/name of org usually sits on or just above the role line
    const company =
      companyIn(l) ??
      companyIn(ls[i - 1]) ??
      companyIn(ls[i - 2]) ??
      companyIn(ls[i + 1]) ??
      companyIn(ls[i + 2]);
    if (!hasRole || (!dates && !company)) return;
    if (/marksheet|grade card|semester|cgpa|marks obtained/i.test(l)) return;

    // take the LAST role word on the line ("Software Developer Intern" → Intern
    // with its modifiers), collecting up to 3 modifier words before it
    const roleWords = [
      ...l.matchAll(
        /\b(intern|internship|engineer|developer|analyst|designer|manager|consultant|associate|executive|officer|scientist|researcher|lead|head|director|coordinator|trainee|apprentice|teacher|professor|accountant|administrator)\w*/gi
      ),
    ];
    let role = '';
    for (const m of roleWords) {
      const before = l.slice(Math.max(0, (m.index ?? 0) - 50), m.index ?? 0);
      const mods =
        /((?:senior|junior|sr\.?|jr\.?|principal|software|web|frontend|front-end|backend|back-end|full[\s-]?stack|data|machine learning|ml|ai|cloud|devops|qa|sales|marketing|hr|operations|business|graphic|content|research|teaching|summer|winter|technical|product|project|program|finance|it|support|system|network|security|intern|internship|engineer|developer|analyst|designer|manager|consultant|associate|executive|officer|scientist|researcher|director|coordinator|trainee|apprentice|teacher|professor|accountant|administrator)\s+){0,3}$/i.exec(
          before
        )?.[0] ?? '';
      role = titleCase((mods + m[0]).trim());
    }

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
  /certif|award|winner|prize|hackathon|marksheet|result|candidate|name|date|subject|marks/i;

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

    // "Project using Python…" — capture is the tech; name lives on a nearby line
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
        // verb at end of line or followed by a connective — name is next line
        name = nameishLine(ls[i + 1]);
      }
      if (name) pushProject(out, seen, name, '');
    }
  });
  return out;
}

const ACHIEVE_RE =
  /\b(award|prize|winner|won|rank|runner[\s-]?up|scholarship|medal|gold|silver|bronze|hackathon|olympiad|merit|distinction|topper|first place|second place|third place|secured|felicitation|recognition|best\s+\w+|finalist|champion|patent|published|publication|dean'?s list)\b/i;

function extractAchievements(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const l of lines(text)) {
    if (l.length < 12 || l.length > 180) continue;
    if (!ACHIEVE_RE.test(l)) continue;
    if (CERT_NOISE.test(l)) continue;
    const clean = l.replace(/\s{2,}/g, ' ').replace(/^[-•*·\d.)\s]+/, '').trim();
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
      .replace(/(?:linked\s?in|github|gitlab|e-?mail|phone|mob(?:ile)?|address|website|portfolio|contact)\s*[:.]/gi, ' ')
      .replace(EMAIL_RE, ' ')
      .replace(/[^\w+#./\s-]/g, ' ') +
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
];
const LANG_RE = new RegExp(
  `\\b(${LANGS.join('|')})\\b\\s*(?:\\(?(?:native|fluent|intermediate|basic|proficient|bilingual)\\)?)?`,
  'gi'
);

function extractLanguages(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(LANG_RE)) {
    if (/\b(course|language of instruction|medium)\b/i.test(m[0])) continue;
    found.add(titleCase(m[1]));
  }
  return [...found];
}

const CITY_RE =
  /\b(mumbai|delhi|new delhi|bengaluru|bangalore|hyderabad|chennai|kolkata|pune|ahmedabad|jaipur|lucknow|kanpur|nagpur|indore|bhopal|patna|surat|kochi|coimbatore|chandigarh|noida|gurugram|gurgaon|thane|visakhapatnam|vadodara|guwahati|bhubaneswar|dehradun|ranchi|raipur|mysore|mysuru|mangalore|varanasi|agra|amritsar|ludhiana|jalandhar|new york|san francisco|los angeles|chicago|boston|seattle|austin|london|singapore|dubai|toronto|sydney|berlin|paris|amsterdam)\b/i;

function extractLocation(text: string): string {
  const labelled = /(?:address|location|residence|city)\s*[:.\-–]\s*([A-Za-z ,-]{3,60})/i.exec(text);
  if (labelled) {
    const city = CITY_RE.exec(labelled[1]);
    if (city) return titleCase(city[0]);
  }
  const city = CITY_RE.exec(text);
  return city ? titleCase(city[0]) : '';
}

/* ------------------------------------------------------------------ */
/* Document classification + merge                                     */
/* ------------------------------------------------------------------ */

export function parseDocuments(texts: string[]): ResumeData {
  const resume = emptyResume();
  const norm = texts.map(normalise);

  for (const t of norm) {
    const email = EMAIL_RE.exec(t)?.[0];
    if (email && !resume.email) resume.email = email.toLowerCase();

    const phone = extractPhone(t);
    if (phone && !resume.phone) resume.phone = phone;

    if (!resume.linkedin || !resume.github || !resume.website) {
      const links = extractLinks(t);
      resume.linkedin ||= links.linkedin;
      resume.github ||= links.github;
      resume.website ||= links.website;
    }

    if (!resume.name) resume.name = extractName(t);
    if (!resume.location) resume.location = extractLocation(t);

    for (const e of extractEducation(t)) {
      if (!resume.education.some((x) => x.degree === e.degree && x.institution === e.institution))
        resume.education.push(e);
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

  if (!resume.name) {
    for (const t of norm) {
      resume.name = guessNameFromLines(t);
      if (resume.name) break;
    }
  }

  // Order education highest→lowest
  const rank = (d: string) =>
    ['Ph.D', 'M.Tech', 'MBA', 'M.Sc', 'MCA', 'M.Com', 'MBBS', 'B.Tech', 'B.E.', 'B.Sc', 'BBA', 'BCA', 'B.Com', 'B.A.', 'LLB', 'Diploma', 'Class XII', 'Class X'].indexOf(d);
  resume.education.sort((a, b) => rank(a.degree) - rank(b.degree));

  // Draft a title + summary skeleton the user can edit
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
