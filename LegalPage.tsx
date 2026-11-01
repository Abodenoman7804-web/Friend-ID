import Link from "next/link";

export default function LegalPage({ title, items }: { title: string; items: [string, string][] }) {
  return (
    <div dir="rtl" className="min-h-screen bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <div className="mx-auto max-w-3xl rounded-3xl bg-white p-8 shadow-xl dark:bg-slate-900">
        <Link href="/" className="text-sm font-bold text-emerald-600 hover:underline">
          → Friend ID
        </Link>
        <h1 className="mb-6 mt-3 text-3xl font-extrabold text-slate-800 dark:text-white">{title}</h1>
        <div className="space-y-4 text-slate-700 dark:text-slate-300">
          {items.map(([head, body]) => (
            <p key={head} className="leading-8">
              <b className="text-slate-900 dark:text-white">{head}</b> {body}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
