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
          <p className="text-sm text-zinc-600">
            Last updated for Meta / WhatsApp Cloud API compliance. For questions, contact{" "}
            <a
              className="text-zinc-900 underline decoration-zinc-400 underline-offset-2 hover:decoration-zinc-600"
              href="mailto:office@heyzoe.io"
            >
              office@heyzoe.io
            </a>
            .
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">Who We Are</h2>
          <p className="text-sm leading-relaxed text-zinc-700">
            Hey Zoe is a smart WhatsApp-based messaging system for businesses. We help businesses
            receive customer messages and send helpful replies through WhatsApp.
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
            We process this information to enable businesses to communicate with their customers
            via WhatsApp, including automated and assisted replies from Zoe.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">Data Sharing</h2>
          <p className="text-sm leading-relaxed text-zinc-700">
            Data is never sold to third parties. We use service providers (such as hosting and
            messaging infrastructure) only as needed to operate the product, under appropriate
            agreements.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">Data Deletion</h2>
          <p className="text-sm leading-relaxed text-zinc-700">You may request deletion by:</p>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-zinc-700">
            <li>
              Emailing{" "}
              <a
                className="text-zinc-900 underline decoration-zinc-400 underline-offset-2 hover:decoration-zinc-600"
                href="mailto:office@heyzoe.io"
              >
                office@heyzoe.io
              </a>{" "}
              with your request
            </li>
            <li>
              Sending the word <span className="font-medium text-zinc-900">הסר</span> in your
              WhatsApp conversation (opt-out / removal flow)
            </li>
          </ul>
          <p className="text-sm leading-relaxed text-zinc-700">
            We will complete deletion within <span className="font-medium text-zinc-900">30 days</span>{" "}
            of a verified request, subject to legal or security retention requirements where
            applicable.
          </p>
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
