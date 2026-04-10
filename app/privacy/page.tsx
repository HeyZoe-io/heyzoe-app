import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | Hey Zoe",
  description: "How Hey Zoe collects, uses, and deletes your data.",
};

export default function PrivacyPage() {
  return (
    <main
      className="min-h-screen bg-zinc-50 px-6 py-10 text-left"
      dir="ltr"
      lang="en"
    >
      <div className="mx-auto max-w-2xl space-y-8">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            Privacy Policy
          </h1>
          <p className="text-sm text-zinc-600">Last updated: April 2026</p>
        </header>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">Who We Are</h2>
          <p className="text-sm leading-relaxed text-zinc-700">
            Hey Zoe is a smart WhatsApp-based messaging system for businesses.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">What Data We Collect</h2>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-zinc-700">
            <li>Phone number</li>
            <li>Name (if provided via WhatsApp)</li>
            <li>Conversation content with Zoe</li>
            <li>Date and time of interactions</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">Why We Collect Data</h2>
          <p className="text-sm leading-relaxed text-zinc-700">
            To enable businesses to communicate with their customers via WhatsApp.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">Data Sharing</h2>
          <p className="text-sm leading-relaxed text-zinc-700">
            Data is never sold to third parties.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">Data Deletion</h2>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-zinc-700">
            <li>
              Send a deletion request to{" "}
              <a
                className="text-zinc-900 underline decoration-zinc-400 underline-offset-2 hover:decoration-zinc-600"
                href="mailto:office@heyzoe.io"
              >
                office@heyzoe.io
              </a>
            </li>
            <li>
              Or send the word <span className="font-medium text-zinc-900">&quot;הסר&quot;</span> in
              your WhatsApp conversation
            </li>
            <li>Data will be deleted within 30 days</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">Contact</h2>
          <p className="text-sm text-zinc-700">
            <a
              className="text-zinc-900 underline decoration-zinc-400 underline-offset-2 hover:decoration-zinc-600"
              href="mailto:office@heyzoe.io"
            >
              office@heyzoe.io
            </a>
          </p>
        </section>
      </div>
    </main>
  );
}
