export default function ConversationsLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-8 w-64 rounded bg-zinc-200 ml-auto" />
        <div className="h-4 w-72 rounded bg-zinc-200 ml-auto" />
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 space-y-3">
        <div className="h-4 w-40 rounded bg-zinc-200 ml-auto" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-3">
            <div className="h-4 w-20 rounded bg-zinc-200" />
            <div className="h-4 w-32 rounded bg-zinc-200 ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}

