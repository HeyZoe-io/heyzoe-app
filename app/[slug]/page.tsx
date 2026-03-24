import ChatZoe from '../components/ChatZoe';
import { getCachedBusinessBySlug } from "@/lib/business-cache";
import { getPublicBusinessBySlug } from "@/lib/business-settings";

type PageProps = { params: Promise<{ slug: string }> };

export default async function Page({ params }: PageProps) {
  const { slug } = await params;
  const [fromBusinesses, fromLegacy] = await Promise.all([
    getPublicBusinessBySlug(slug),
    getCachedBusinessBySlug(slug),
  ]);
  const exists = Boolean(fromBusinesses || fromLegacy);

  if (!exists) {
    return (
      <main className="min-h-screen bg-[#f7f7f5] text-neutral-900 flex flex-col items-center justify-center px-4 py-10 md:py-14 antialiased">
        <div className="w-full max-w-md">
          <div className="bg-white/90 backdrop-blur-sm border border-neutral-200/60 rounded-[1.75rem] shadow-[0_2px_24px_rgba(0,0,0,0.04)] px-6 py-8 text-center">
            <h1 className="text-xl font-semibold text-neutral-900">Business Not Found</h1>
            <p className="mt-2 text-sm text-neutral-600">
              לא מצאנו עסק עם הסלאג הזה. בדקו את הכתובת או צרו קשר עם בעל העסק.
            </p>
          </div>
          <p className="text-center text-[11px] text-neutral-400 mt-8 tracking-wide tabular-nums">
            © {new Date().getFullYear()} HeyZoe
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f7f5] text-neutral-900 flex flex-col items-center justify-center px-4 py-10 md:py-14 antialiased">
      <div className="w-full max-w-md">
        <div className="bg-white/90 backdrop-blur-sm border border-neutral-200/60 rounded-[1.75rem] shadow-[0_2px_24px_rgba(0,0,0,0.04)] px-4 pt-5 pb-4 md:px-6 md:pt-6 md:pb-5">
          <ChatZoe slug={slug} />
        </div>
        <p className="text-center text-[11px] text-neutral-400 mt-8 tracking-wide tabular-nums">
          © {new Date().getFullYear()} HeyZoe
        </p>
      </div>
    </main>
  );
}
