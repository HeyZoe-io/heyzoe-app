export default function AnalyticsLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-8 w-64 rounded bg-zinc-200 ml-auto" />
        <div className="h-4 w-56 rounded bg-zinc-200 ml-auto" />
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-zinc-200 bg-white p-4">
            <div className="h-3 w-28 rounded bg-zinc-200 ml-auto" />
            <div className="mt-3 h-8 w-20 rounded bg-zinc-200 ml-auto" />
          </div>
        ))}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-zinc-200 bg-white p-4">
            <div className="h-4 w-28 rounded bg-zinc-200 ml-auto" />
            <div className="mt-3 h-10 w-24 rounded bg-zinc-200 ml-auto" />
            <div className="mt-3 h-3 w-64 rounded bg-zinc-200 ml-auto" />
            <div className="mt-2 h-3 w-56 rounded bg-zinc-200 ml-auto" />
          </div>
        ))}
      </section>
    </div>
  );
}

