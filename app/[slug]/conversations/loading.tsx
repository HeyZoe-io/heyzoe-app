export default function ConversationsLoading() {
  return (
    <div className="flex h-[calc(100dvh-9.5rem)] min-h-[520px] animate-pulse overflow-hidden rounded-xl border border-[#e9edef] bg-white">
      <aside className="hidden w-[380px] shrink-0 flex-col border-e border-[#e9edef] bg-white md:flex">
        <div className="h-[59px] bg-[#f0f2f5]" />
        <div className="px-3 py-3">
          <div className="h-9 rounded-lg bg-[#f0f2f5]" />
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-[#f0f2f5] px-3 py-3">
            <div className="h-12 w-12 shrink-0 rounded-full bg-[#f0f2f5]" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-3/4 rounded bg-[#f0f2f5]" />
              <div className="h-3 w-1/2 rounded bg-[#f0f2f5]" />
            </div>
          </div>
        ))}
      </aside>
      <section className="flex flex-1 flex-col bg-[#f0f2f5]">
        <div className="h-[59px] border-b border-[#e9edef] bg-[#f0f2f5]" />
        <div className="wa-chat-wallpaper flex-1" />
      </section>
    </div>
  );
}
