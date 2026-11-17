'use client';

import {
  Certification,
  Education,
  Experience,
  Project,
  ResumeData,
  uid,
} from '@/lib/types';

const input =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';
const label = 'mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500';

function Field({
  label: text,
  value,
  onChange,
  placeholder,
  textarea,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  textarea?: boolean;
}) {
  return (
    <div>
      <span className={label}>{text}</span>
      {textarea ? (
        <textarea
          className={input + ' min-h-24 resize-y'}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className={input}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

function Section({
  title,
  onAdd,
  addLabel,
  children,
}: {
  title: string;
  onAdd?: () => void;
  addLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
          {title}
        </h3>
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
          >
            + {addLabel ?? 'Add'}
          </button>
        )}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function RemoveBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Remove"
      className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
    >
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" strokeWidth={1.8} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.35 9m-4.78 0L9.26 9m9.97-3.21c.34.05.68.11 1.02.17m-1.02-.17L18.16 19.67a2.25 2.25 0 01-2.24 2.08H8.08a2.25 2.25 0 01-2.24-2.08L4.77 5.79m14.46 0a48 48 0 00-3.48-.4m-12 .56c.34-.06.68-.12 1.02-.17m0 0a48 48 0 013.48-.4m7.5 0v-.92c0-1.18-.91-2.14-2.04-2.18a48 48 0 00-3.42 0c-1.13.04-2.04 1-2.04 2.18v.92m7.5 0a48 48 0 00-7.5 0" />
      </svg>
    </button>
  );
}

function ListEditor({
  items,
  onChange,
  placeholder,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
}) {
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            className={input}
            value={item}
            placeholder={placeholder}
            onChange={(e) => {
              const next = [...items];
              next[i] = e.target.value;
              onChange(next);
            }}
          />
          <RemoveBtn onClick={() => onChange(items.filter((_, j) => j !== i))} />
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, ''])}
        className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
      >
        + Add item
      </button>
    </div>
  );
}

export default function ResumeForm({
  resume,
  onChange,
}: {
  resume: ResumeData;
  onChange: (r: ResumeData) => void;
}) {
  const set = <K extends keyof ResumeData>(key: K, value: ResumeData[K]) =>
    onChange({ ...resume, [key]: value });

  const patchList = <T extends { id: string }>(
    key: keyof ResumeData,
    id: string,
    patch: Partial<T>
  ) =>
    set(
      key,
      (resume[key] as unknown as T[]).map((it) =>
        it.id === id ? { ...it, ...patch } : it
      ) as never
    );

  const removeFrom = (key: keyof ResumeData, id: string) =>
    set(
      key,
      (resume[key] as unknown as { id: string }[]).filter(
        (it) => it.id !== id
      ) as never
    );

  return (
    <div className="space-y-5">
      <Section title="Personal details">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Full name" value={resume.name} onChange={(v) => set('name', v)} placeholder="Jane Doe" />
          <Field label="Title / headline" value={resume.title} onChange={(v) => set('title', v)} placeholder="B.Tech CSE Graduate" />
          <Field label="Email" value={resume.email} onChange={(v) => set('email', v)} placeholder="jane@example.com" />
          <Field label="Phone" value={resume.phone} onChange={(v) => set('phone', v)} placeholder="+91 98765 43210" />
          <Field label="Location" value={resume.location} onChange={(v) => set('location', v)} placeholder="Mumbai" />
          <Field label="Website" value={resume.website} onChange={(v) => set('website', v)} placeholder="https://…" />
          <Field label="LinkedIn" value={resume.linkedin} onChange={(v) => set('linkedin', v)} placeholder="https://linkedin.com/in/…" />
          <Field label="GitHub" value={resume.github} onChange={(v) => set('github', v)} placeholder="https://github.com/…" />
        </div>
        <Field
          label="Professional summary"
          value={resume.summary}
          onChange={(v) => set('summary', v)}
          placeholder="A short paragraph about you…"
          textarea
        />
      </Section>

      <Section
        title="Education"
        addLabel="Education"
        onAdd={() =>
          set('education', [
            { id: uid(), institution: '', degree: '', field: '', startYear: '', endYear: '', grade: '' },
            ...resume.education,
          ])
        }
      >
        {resume.education.length === 0 && (
          <p className="text-sm text-slate-400">No education entries detected — add one above.</p>
        )}
        {resume.education.map((e) => (
          <div key={e.id} className="relative rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <div className="absolute right-2 top-2">
              <RemoveBtn onClick={() => removeFrom('education', e.id)} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Degree" value={e.degree} onChange={(v) => patchList<Education>('education', e.id, { degree: v })} placeholder="B.Tech" />
              <Field label="Field of study" value={e.field} onChange={(v) => patchList<Education>('education', e.id, { field: v })} placeholder="Computer Science" />
              <div className="sm:col-span-2">
                <Field label="Institution" value={e.institution} onChange={(v) => patchList<Education>('education', e.id, { institution: v })} placeholder="University / School" />
              </div>
              <Field label="Start year" value={e.startYear} onChange={(v) => patchList<Education>('education', e.id, { startYear: v })} placeholder="2019" />
              <Field label="End year" value={e.endYear} onChange={(v) => patchList<Education>('education', e.id, { endYear: v })} placeholder="2023" />
              <Field label="Grade / score" value={e.grade} onChange={(v) => patchList<Education>('education', e.id, { grade: v })} placeholder="8.5 CGPA / 92%" />
            </div>
          </div>
        ))}
      </Section>

      <Section
        title="Experience"
        addLabel="Role"
        onAdd={() =>
          set('experience', [
            { id: uid(), company: '', role: '', startDate: '', endDate: '', description: '' },
            ...resume.experience,
          ])
        }
      >
        {resume.experience.length === 0 && (
          <p className="text-sm text-slate-400">No experience detected — add roles, internships or volunteer work.</p>
        )}
        {resume.experience.map((x) => (
          <div key={x.id} className="relative rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <div className="absolute right-2 top-2">
              <RemoveBtn onClick={() => removeFrom('experience', x.id)} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Role" value={x.role} onChange={(v) => patchList<Experience>('experience', x.id, { role: v })} placeholder="Software Intern" />
              <Field label="Company / org" value={x.company} onChange={(v) => patchList<Experience>('experience', x.id, { company: v })} placeholder="Acme Corp" />
              <Field label="Start" value={x.startDate} onChange={(v) => patchList<Experience>('experience', x.id, { startDate: v })} placeholder="Jun 2023" />
              <Field label="End" value={x.endDate} onChange={(v) => patchList<Experience>('experience', x.id, { endDate: v })} placeholder="Present" />
              <div className="sm:col-span-2">
                <Field label="What you did" value={x.description} onChange={(v) => patchList<Experience>('experience', x.id, { description: v })} placeholder="Key responsibilities & outcomes…" textarea />
              </div>
            </div>
          </div>
        ))}
      </Section>

      <Section title="Skills">
        <ListEditor
          items={resume.skills}
          onChange={(v) => set('skills', v)}
          placeholder="e.g. Python, React, Data Analysis"
        />
      </Section>

      <Section
        title="Certifications"
        addLabel="Certification"
        onAdd={() =>
          set('certifications', [
            { id: uid(), name: '', issuer: '', year: '' },
            ...resume.certifications,
          ])
        }
      >
        {resume.certifications.length === 0 && (
          <p className="text-sm text-slate-400">No certifications detected.</p>
        )}
        {resume.certifications.map((c) => (
          <div key={c.id} className="relative rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <div className="absolute right-2 top-2">
              <RemoveBtn onClick={() => removeFrom('certifications', c.id)} />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <Field label="Certificate" value={c.name} onChange={(v) => patchList<Certification>('certifications', c.id, { name: v })} placeholder="AWS Cloud Practitioner" />
              </div>
              <Field label="Issuer" value={c.issuer} onChange={(v) => patchList<Certification>('certifications', c.id, { issuer: v })} placeholder="AWS" />
              <Field label="Year" value={c.year} onChange={(v) => patchList<Certification>('certifications', c.id, { year: v })} placeholder="2024" />
            </div>
          </div>
        ))}
      </Section>

      <Section
        title="Projects"
        addLabel="Project"
        onAdd={() =>
          set('projects', [{ id: uid(), name: '', description: '', tech: '' }, ...resume.projects])
        }
      >
        {resume.projects.length === 0 && (
          <p className="text-sm text-slate-400">No projects detected — add your best work.</p>
        )}
        {resume.projects.map((p) => (
          <div key={p.id} className="relative rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <div className="absolute right-2 top-2">
              <RemoveBtn onClick={() => removeFrom('projects', p.id)} />
            </div>
            <div className="grid grid-cols-1 gap-3">
              <Field label="Project name" value={p.name} onChange={(v) => patchList<Project>('projects', p.id, { name: v })} placeholder="Portfolio website" />
              <Field label="Tech used" value={p.tech} onChange={(v) => patchList<Project>('projects', p.id, { tech: v })} placeholder="Next.js, Tailwind" />
              <Field label="Description" value={p.description} onChange={(v) => patchList<Project>('projects', p.id, { description: v })} placeholder="What it does, your role…" textarea />
            </div>
          </div>
        ))}
      </Section>

      <Section title="Achievements & awards">
        <ListEditor
          items={resume.achievements}
          onChange={(v) => set('achievements', v)}
          placeholder="e.g. Winner — Smart India Hackathon 2024"
        />
      </Section>

      <Section title="Languages">
        <ListEditor
          items={resume.languages}
          onChange={(v) => set('languages', v)}
          placeholder="e.g. English (fluent), Hindi (native)"
        />
      </Section>
    </div>
  );
}
