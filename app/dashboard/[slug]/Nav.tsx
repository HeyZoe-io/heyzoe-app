import Link from "next/link";

export default function DashboardSlugNav({ slug }: { slug: string }) {
  return (
    <nav className="mb-4 flex justify-end gap-2 text-sm">
      <Link
        href={`/dashboard/${slug}/settings`}
        className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-zinc-700 hover:bg-zinc-50"
      >
        הגדרות
      </Link>
      <Link
        href={`/dashboard/${slug}/analytics`}
        className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-zinc-700 hover:bg-zinc-50"
      >
        אנליטיקס
      </Link>
      <Link
        href={`/dashboard/${slug}/conversations`}
        className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-zinc-700 hover:bg-zinc-50"
      >
        שיחות
      </Link>
    </nav>
  );
}

