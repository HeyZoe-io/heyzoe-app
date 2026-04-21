export default function NotFound() {
  return (
    <main className="min-h-screen bg-white text-zinc-900">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 text-center">
        <p className="text-sm font-medium tracking-[0.2em] text-zinc-400">404</p>
        <h1 className="mt-4 text-3xl font-semibold text-zinc-900">העמוד לא נמצא</h1>
        <p className="mt-3 max-w-lg text-sm leading-6 text-zinc-500">
          הכתובת שאליה ניסית להגיע אינה זמינה.
        </p>
      </div>
    </main>
  );
}

