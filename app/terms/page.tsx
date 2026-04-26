import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service | Hey Zoe",
  description: "Terms of Service for using Hey Zoe.",
};

export default function TermsPage() {
  return (
    <main
      className="min-h-screen bg-zinc-50 px-6 py-10 text-left"
      dir="ltr"
      lang="en"
    >
      <div className="mx-auto max-w-2xl space-y-8">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            Terms of Service
          </h1>
          <p className="text-sm text-zinc-600">Last updated: April 2026</p>
        </header>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">1. Introduction</h2>
          <p className="text-sm leading-relaxed text-zinc-700">
            Hey Zoe is a WhatsApp-based smart messaging system that helps businesses communicate with
            their customers. By using Hey Zoe, you agree to these Terms of Service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">2. Services</h2>
          <p className="text-sm leading-relaxed text-zinc-700">Hey Zoe provides:</p>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-zinc-700">
            <li>Automated WhatsApp messaging via an AI assistant called Zoe</li>
            <li>Business dashboard for managing conversations and contacts</li>
            <li>Campaign messaging tools</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">3. User Responsibilities</h2>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-zinc-700">
            <li>You agree not to use Hey Zoe for spam or illegal activity</li>
            <li>You agree to comply with WhatsApp&apos;s Terms of Service</li>
            <li>Business owners are responsible for the content sent through Zoe</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">4. Data &amp; Privacy</h2>
          <p className="text-sm leading-relaxed text-zinc-700">
            Hey Zoe stores all WhatsApp conversations conducted through the platform. These
            conversations may be accessed by the Hey Zoe team for purposes of technical support,
            service improvement, and platform monitoring.
          </p>
          <p className="text-sm leading-relaxed text-zinc-700">
            Business owners acknowledge and consent to this data access as a condition of using the
            service.
          </p>
          <p className="text-sm leading-relaxed text-zinc-700">
            For full details, see our Privacy Policy at{" "}
            <a
              className="text-zinc-900 underline decoration-zinc-400 underline-offset-2 hover:decoration-zinc-600"
              href="https://heyzoe.io/privacy"
            >
              https://heyzoe.io/privacy
            </a>
            .
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">5. Opt-out</h2>
          <p className="text-sm leading-relaxed text-zinc-700">
            Users can opt out of messages at any time by sending{" "}
            <span className="font-medium text-zinc-900" dir="rtl" lang="he">
              הסר
            </span>{" "}
            in the WhatsApp conversation.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">6. WhatsApp Number Usage</h2>
          <p className="text-sm leading-relaxed text-zinc-700">
            The WhatsApp number provided to the business as part of the Hey Zoe service is allocated
            exclusively for use during an active subscription period. Upon cancellation or expiration
            of the subscription, access to the WhatsApp number will be revoked and the number may be
            reassigned. Hey Zoe retains ownership of all WhatsApp numbers provided through the
            platform.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">7. Dashboard Access</h2>
          <p className="text-sm leading-relaxed text-zinc-700">
            Access to the Hey Zoe business dashboard is granted solely to authorized users of the
            subscribing business. Account credentials must not be shared with unauthorized third
            parties. Hey Zoe reserves the right to suspend dashboard access in cases of misuse,
            non-payment, or violation of these Terms of Service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">8. Limitation of Liability</h2>
          <p className="text-sm leading-relaxed text-zinc-700">
            Hey Zoe is not responsible for the content sent by business owners through the platform.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">9. Changes to Terms</h2>
          <p className="text-sm leading-relaxed text-zinc-700">
            We reserve the right to update these terms at any time. Continued use of the service
            constitutes acceptance.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">10. Contact</h2>
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
