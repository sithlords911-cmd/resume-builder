import ResumeBuilder from '@/components/ResumeBuilder';

export default function Page() {
  return (
    <main className="flex-1">
      <ResumeBuilder />
      <footer className="no-print border-t border-slate-200 py-6 text-center text-xs text-slate-400">
        DocuResume — 100% client-side. Your documents are read in the browser and
        never uploaded, stored, or shared.
      </footer>
    </main>
  );
}
