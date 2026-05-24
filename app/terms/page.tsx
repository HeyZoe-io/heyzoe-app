import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service | Hey Zoe",
  description: "Terms of Service for using Hey Zoe.",
};

const linkClass =
  "text-zinc-900 underline decoration-zinc-400 underline-offset-2 hover:decoration-zinc-600";

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
          <p className="text-sm text-zinc-600">Last updated: May 2026</p>
        </header>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">1. Introduction</h2>
          <p className="text-sm leading-relaxed text-zinc-700">
            Hey Zoe (&quot;Company&quot;, &quot;we&quot;, &quot;us&quot;) operates a WhatsApp-based AI
            messaging platform for businesses (heyzoe.io). By using Hey Zoe, you agree to these Terms
            of Service. If you do not agree, please discontinue use of the service.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">2. Services</h2>
          <p className="text-sm leading-relaxed text-zinc-700">Hey Zoe provides:</p>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-zinc-700">
            <li>Automated WhatsApp messaging via an AI assistant called Zoe</li>
            <li>A business dashboard for managing conversations and contacts</li>
            <li>Campaign messaging tools</li>
            <li>Analytics and reporting features</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">3. User Responsibilities</h2>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-zinc-700">
            <li>You agree not to use Hey Zoe for spam, harassment, or illegal activity</li>
            <li>You agree to comply with WhatsApp&apos;s Terms of Service and Meta&apos;s policies</li>
            <li>Business owners are solely responsible for the content sent through Zoe</li>
            <li>Account credentials must not be shared with unauthorized third parties</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">4. Data &amp; Privacy</h2>
          <p className="text-sm leading-relaxed text-zinc-700">
            Hey Zoe stores WhatsApp conversations conducted through the platform. Conversation data
            may be accessed by the Hey Zoe team{" "}
            <span className="font-medium text-zinc-900">
              only for technical support purposes, and only when explicitly requested by the business
              owner.
            </span>
          </p>
          <p className="text-sm leading-relaxed text-zinc-700">
            We do not sell or share conversation data with third parties. For full details, see our
            Privacy Policy at{" "}
            <a className={linkClass} href="https://heyzoe.io/privacy">
              https://heyzoe.io/privacy
            </a>
            .
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">5. Opt-Out</h2>
          <p className="text-sm leading-relaxed text-zinc-700">
            End users can opt out of messages at any time by sending{" "}
            <span className="font-medium text-zinc-900" dir="rtl" lang="he">
              הסר
            </span>{" "}
            in the WhatsApp conversation. Opt-out requests will be processed immediately.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">6. WhatsApp Number Usage</h2>
          <p className="text-sm leading-relaxed text-zinc-700">
            The WhatsApp number provided as part of the Hey Zoe service is allocated exclusively for
            use during an active subscription period. Upon cancellation or expiration, access to the
            number will be revoked and it may be reassigned. Hey Zoe retains ownership of all
            WhatsApp numbers provided through the platform.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">7. Subscription &amp; Payment</h2>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-zinc-700">
            <li>Hey Zoe operates on a monthly subscription basis</li>
            <li>Payments are processed via iCount</li>
            <li>Subscriptions renew automatically unless cancelled</li>
            <li>No refunds are provided for partial months</li>
            <li>Hey Zoe reserves the right to suspend service for non-payment</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">8. Dashboard Access</h2>
          <p className="text-sm leading-relaxed text-zinc-700">
            Access to the Hey Zoe business dashboard is granted solely to authorized users of the
            subscribing business. Hey Zoe reserves the right to suspend access in cases of misuse,
            non-payment, or violation of these Terms.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">9. Limitation of Liability</h2>
          <p className="text-sm leading-relaxed text-zinc-700">
            Hey Zoe is not responsible for the content sent by business owners through the platform.
            To the maximum extent permitted by law, Hey Zoe&apos;s total liability for any claim
            arising from use of the service shall not exceed the amount paid by the business in the{" "}
            <span className="font-medium text-zinc-900">3 months</span> preceding the claim.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">10. Termination</h2>
          <p className="text-sm leading-relaxed text-zinc-700">
            Hey Zoe reserves the right to terminate or suspend access to the service at any time,
            with or without notice, for violations of these Terms or for any other reason at our sole
            discretion.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">11. Changes to Terms</h2>
          <p className="text-sm leading-relaxed text-zinc-700">
            We reserve the right to update these Terms at any time. We will notify active users of
            material changes via email. Continued use of the service after changes constitutes
            acceptance of the updated Terms.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">12. Governing Law</h2>
          <p className="text-sm leading-relaxed text-zinc-700">
            These Terms are governed by the laws of the{" "}
            <span className="font-medium text-zinc-900">State of Israel</span>. Any disputes shall be
            resolved in the competent courts of Tel Aviv, Israel.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">13. Contact</h2>
          <p className="text-sm leading-relaxed text-zinc-700">
            <span className="font-medium text-zinc-900">Hey Zoe</span>
            <br />
            Email:{" "}
            <a className={linkClass} href="mailto:office@heyzoe.io">
              office@heyzoe.io
            </a>
            <br />
            Website:{" "}
            <a className={linkClass} href="https://heyzoe.io">
              https://heyzoe.io
            </a>
          </p>
        </section>
      </div>
    </main>
  );
}
