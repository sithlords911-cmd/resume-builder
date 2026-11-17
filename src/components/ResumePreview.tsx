'use client';

import { ResumeData } from '@/lib/types';

export type TemplateId = 'modern' | 'classic';

function contactLine(r: ResumeData): string[] {
  return [r.email, r.phone, r.location, r.linkedin.replace(/^https?:\/\//, ''), r.github.replace(/^https?:\/\//, ''), r.website.replace(/^https?:\/\//, '')].filter(Boolean);
}

function eduLine(e: { degree: string; field: string }) {
  return [e.degree, e.field].filter(Boolean).join(' in ');
}

function dateRange(a: string, b: string) {
  return [a, b].filter(Boolean).join(' – ');
}

/* ---------------- Modern: sidebar layout ---------------- */

function ModernTemplate({ r }: { r: ResumeData }) {
  return (
    <div className="flex min-h-[1122px] w-full bg-white font-sans text-slate-800" style={{ fontSize: 13 }}>
      {/* Sidebar */}
      <aside className="w-[34%] bg-slate-800 p-7 text-slate-100">
        <h1 className="text-2xl font-bold leading-tight tracking-tight">{r.name || 'Your Name'}</h1>
        {r.title && <p className="mt-1 text-sm font-medium text-indigo-300">{r.title}</p>}

        {contactLine(r).length > 0 && (
          <div className="mt-7">
            <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.15em] text-indigo-300">Contact</h2>
            <ul className="space-y-1.5 break-all text-[12px] text-slate-200">
              {contactLine(r).map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        )}

        {r.skills.length > 0 && (
          <div className="mt-7">
            <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.15em] text-indigo-300">Skills</h2>
            <div className="flex flex-wrap gap-1.5">
              {r.skills.filter(Boolean).map((s) => (
                <span key={s} className="rounded bg-slate-700 px-2 py-0.5 text-[11px] text-slate-100">
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}

        {r.languages.length > 0 && (
          <div className="mt-7">
            <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.15em] text-indigo-300">Languages</h2>
            <ul className="space-y-1 text-[12px] text-slate-200">
              {r.languages.filter(Boolean).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
        )}
      </aside>

      {/* Main */}
      <main className="flex-1 p-8">
        {r.summary && (
          <section className="mb-6">
            <h2 className="mb-2 border-b-2 border-slate-800 pb-1 text-[13px] font-bold uppercase tracking-[0.12em] text-slate-800">
              Summary
            </h2>
            <p className="leading-relaxed text-slate-600">{r.summary}</p>
          </section>
        )}

        {r.education.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-3 border-b-2 border-slate-800 pb-1 text-[13px] font-bold uppercase tracking-[0.12em] text-slate-800">
              Education
            </h2>
            <div className="space-y-3.5">
              {r.education.map((e) => (
                <div key={e.id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="font-semibold text-slate-800">{eduLine(e) || 'Degree'}</h3>
                    <span className="shrink-0 text-[12px] text-slate-500">{dateRange(e.startYear, e.endYear)}</span>
                  </div>
                  <p className="text-slate-600">{e.institution}</p>
                  {e.grade && <p className="text-[12px] text-slate-500">Score: {e.grade}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {r.experience.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-3 border-b-2 border-slate-800 pb-1 text-[13px] font-bold uppercase tracking-[0.12em] text-slate-800">
              Experience
            </h2>
            <div className="space-y-3.5">
              {r.experience.map((x) => (
                <div key={x.id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="font-semibold text-slate-800">{x.role}</h3>
                    <span className="shrink-0 text-[12px] text-slate-500">{dateRange(x.startDate, x.endDate)}</span>
                  </div>
                  <p className="text-slate-600">{x.company}</p>
                  {x.description && <p className="mt-1 whitespace-pre-line text-[12px] leading-relaxed text-slate-500">{x.description}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {r.projects.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-3 border-b-2 border-slate-800 pb-1 text-[13px] font-bold uppercase tracking-[0.12em] text-slate-800">
              Projects
            </h2>
            <div className="space-y-3">
              {r.projects.map((p) => (
                <div key={p.id}>
                  <h3 className="font-semibold text-slate-800">
                    {p.name}
                    {p.tech && <span className="ml-2 font-normal text-[12px] text-slate-500">· {p.tech}</span>}
                  </h3>
                  {p.description && <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">{p.description}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {r.certifications.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-3 border-b-2 border-slate-800 pb-1 text-[13px] font-bold uppercase tracking-[0.12em] text-slate-800">
              Certifications
            </h2>
            <ul className="space-y-1.5">
              {r.certifications.map((c) => (
                <li key={c.id} className="flex items-baseline justify-between gap-3 text-slate-600">
                  <span>
                    {c.name}
                    {c.issuer && <span className="text-slate-500"> — {c.issuer}</span>}
                  </span>
                  <span className="shrink-0 text-[12px] text-slate-500">{c.year}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {r.achievements.length > 0 && (
          <section>
            <h2 className="mb-3 border-b-2 border-slate-800 pb-1 text-[13px] font-bold uppercase tracking-[0.12em] text-slate-800">
              Achievements
            </h2>
            <ul className="list-disc space-y-1 pl-5 text-[12px] text-slate-600">
              {r.achievements.filter(Boolean).map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}

/* ---------------- Classic: centered serif ---------------- */

function ClassicH({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2 mt-6 border-b border-slate-400 pb-1 text-center text-[13px] font-bold uppercase tracking-[0.2em] text-slate-700">
      {children}
    </h2>
  );
}

function ClassicTemplate({ r }: { r: ResumeData }) {
  return (
    <div className="mx-auto min-h-[1122px] w-full max-w-[700px] bg-white p-10 font-serif text-slate-800" style={{ fontSize: 13.5 }}>
      <header className="text-center">
        <h1 className="text-3xl font-bold tracking-wide">{r.name || 'Your Name'}</h1>
        {r.title && <p className="mt-1 text-[14px] italic text-slate-600">{r.title}</p>}
        {contactLine(r).length > 0 && (
          <p className="mt-3 text-[12px] text-slate-500">{contactLine(r).join('  ·  ')}</p>
        )}
      </header>

      {r.summary && (
        <section>
          <ClassicH>Summary</ClassicH>
          <p className="text-justify leading-relaxed text-slate-700">{r.summary}</p>
        </section>
      )}

      {r.education.length > 0 && (
        <section>
          <ClassicH>Education</ClassicH>
          <div className="space-y-3">
            {r.education.map((e) => (
              <div key={e.id} className="flex items-baseline justify-between gap-4">
                <div>
                  <span className="font-bold">{eduLine(e)}</span>
                  {e.institution && <span className="text-slate-600">, {e.institution}</span>}
                  {e.grade && <span className="text-slate-500"> — {e.grade}</span>}
                </div>
                <span className="shrink-0 text-[12px] text-slate-500">{dateRange(e.startYear, e.endYear)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {r.experience.length > 0 && (
        <section>
          <ClassicH>Experience</ClassicH>
          <div className="space-y-3.5">
            {r.experience.map((x) => (
              <div key={x.id}>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-bold">
                    {x.role}
                    {x.company && <span className="font-normal text-slate-600">, {x.company}</span>}
                  </span>
                  <span className="shrink-0 text-[12px] text-slate-500">{dateRange(x.startDate, x.endDate)}</span>
                </div>
                {x.description && <p className="mt-0.5 whitespace-pre-line text-[12.5px] leading-relaxed text-slate-600">{x.description}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {r.skills.length > 0 && (
        <section>
          <ClassicH>Skills</ClassicH>
          <p className="text-center text-slate-700">{r.skills.filter(Boolean).join('  ·  ')}</p>
        </section>
      )}

      {r.certifications.length > 0 && (
        <section>
          <ClassicH>Certifications</ClassicH>
          <ul className="space-y-1">
            {r.certifications.map((c) => (
              <li key={c.id} className="flex items-baseline justify-between gap-4 text-slate-700">
                <span>
                  {c.name}
                  {c.issuer && <span className="text-slate-500"> — {c.issuer}</span>}
                </span>
                <span className="shrink-0 text-[12px] text-slate-500">{c.year}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {r.projects.length > 0 && (
        <section>
          <ClassicH>Projects</ClassicH>
          <div className="space-y-2.5">
            {r.projects.map((p) => (
              <div key={p.id}>
                <span className="font-bold">{p.name}</span>
                {p.tech && <span className="text-slate-500"> ({p.tech})</span>}
                {p.description && <p className="mt-0.5 text-[12.5px] text-slate-600">{p.description}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {r.achievements.length > 0 && (
        <section>
          <ClassicH>Achievements</ClassicH>
          <ul className="list-disc space-y-1 pl-6 text-[12.5px] text-slate-700">
            {r.achievements.filter(Boolean).map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </section>
      )}

      {r.languages.length > 0 && (
        <section>
          <ClassicH>Languages</ClassicH>
          <p className="text-center text-slate-700">{r.languages.filter(Boolean).join('  ·  ')}</p>
        </section>
      )}
    </div>
  );
}

export default function ResumePreview({
  resume,
  template,
}: {
  resume: ResumeData;
  template: TemplateId;
}) {
  return (
    <div
      id="resume-print-area"
      className="overflow-hidden rounded-xl border border-slate-200 shadow-lg"
      style={{ aspectRatio: '210/297' }}
    >
      <div className="h-full overflow-y-auto">
        {template === 'modern' ? <ModernTemplate r={resume} /> : <ClassicTemplate r={resume} />}
      </div>
    </div>
  );
}
