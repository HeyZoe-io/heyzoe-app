import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | Hey Zoe",
  description:
    "How Hey Zoe collects, uses, retains, and deletes personal data for WhatsApp messaging.",
};

const linkClass =
  "text-zinc-900 underline decoration-zinc-400 underline-offset-2 hover:decoration-zinc-600";

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
          <p className="text-sm text-zinc-600">Last updated: May 2026</p>
        </header>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">1. Who We Are</h2>
          <p className="text-sm leading-relaxed text-zinc-700">
            Hey Zoe (&quot;Company&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) operates a
            WhatsApp-based AI messaging platform for businesses (heyzoe.io). We provide businesses
            with an automated assistant (&quot;Zoe&quot;) that communicates with their customers via
            WhatsApp.
          </p>
          <p className="text-sm leading-relaxed text-zinc-700">
            <span className="font-medium text-zinc-900">Contact:</span>{" "}
            <a className={linkClass} href="mailto:office@heyzoe.io">
              office@heyzoe.io
            </a>
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">2. What Data We Collect</h2>
          <p className="text-sm leading-relaxed text-zinc-700">
            When you interact with Zoe via WhatsApp, we may collect:
          </p>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-zinc-700">
            <li>
              <span className="font-medium text-zinc-900">Phone number</span> — provided
              automatically via WhatsApp
            </li>
            <li>
              <span className="font-medium text-zinc-900">Name</span> — if shared during the
              conversation
            </li>
            <li>
              <span className="font-medium text-zinc-900">Conversation content</span> — messages
              exchanged with Zoe
            </li>
            <li>
              <span className="font-medium text-zinc-900">Date and time</span> of interactions
            </li>
            <li>
              <span className="font-medium text-zinc-900">Business identifier</span> — which
              business account you contacted
            </li>
          </ul>
          <p className="text-sm leading-relaxed text-zinc-700">
            We do <span className="font-medium text-zinc-900">not</span> collect payment
            information, government IDs, or sensitive personal data.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">3. How We Use Your Data</h2>
          <p className="text-sm leading-relaxed text-zinc-700">
            We use the data collected solely to:
          </p>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-zinc-700">
            <li>Enable businesses to communicate with their customers via WhatsApp</li>
            <li>Power automated responses from the Zoe AI assistant</li>
            <li>Improve the quality and accuracy of responses</li>
            <li>Comply with legal obligations</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">4. Legal Basis for Processing</h2>
          <p className="text-sm leading-relaxed text-zinc-700">
            We process your personal data on the following legal bases:
          </p>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-zinc-700">
            <li>
              <span className="font-medium text-zinc-900">Legitimate interest</span> — to provide
              the messaging service you initiated
            </li>
            <li>
              <span className="font-medium text-zinc-900">Consent</span> — where explicitly obtained
            </li>
            <li>
              <span className="font-medium text-zinc-900">Legal obligation</span> — where required by
              applicable law
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">5. Third-Party Service Providers</h2>
          <p className="text-sm leading-relaxed text-zinc-700">
            We share data only with trusted processors necessary to operate the service:
          </p>
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
            <table className="w-full min-w-[28rem] text-left text-sm text-zinc-700">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50/80">
                  <th className="px-3 py-2.5 font-semibold text-zinc-900">Provider</th>
                  <th className="px-3 py-2.5 font-semibold text-zinc-900">Purpose</th>
                  <th className="px-3 py-2.5 font-semibold text-zinc-900">Privacy Policy</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-zinc-100">
                  <td className="px-3 py-2.5 font-medium text-zinc-900">Meta (WhatsApp)</td>
                  <td className="px-3 py-2.5">Message delivery infrastructure</td>
                  <td className="px-3 py-2.5">
                    <a className={linkClass} href="https://www.meta.com/privacy/">
                      meta.com/privacy
                    </a>
                  </td>
                </tr>
                <tr className="border-b border-zinc-100">
                  <td className="px-3 py-2.5 font-medium text-zinc-900">Anthropic</td>
                  <td className="px-3 py-2.5">AI response generation (Claude API)</td>
                  <td className="px-3 py-2.5">
                    <a className={linkClass} href="https://www.anthropic.com/privacy">
                      anthropic.com/privacy
                    </a>
                  </td>
                </tr>
                <tr className="border-b border-zinc-100">
                  <td className="px-3 py-2.5 font-medium text-zinc-900">Supabase</td>
                  <td className="px-3 py-2.5">Secure data storage</td>
                  <td className="px-3 py-2.5">
                    <a className={linkClass} href="https://supabase.com/privacy">
                      supabase.com/privacy
                    </a>
                  </td>
                </tr>
                <tr>
                  <td className="px-3 py-2.5 font-medium text-zinc-900">Vercel</td>
                  <td className="px-3 py-2.5">Application hosting</td>
                  <td className="px-3 py-2.5">
                    <a className={linkClass} href="https://vercel.com/legal/privacy-policy">
                      vercel.com/legal/privacy-policy
                    </a>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-sm leading-relaxed text-zinc-700">
            We <span className="font-medium text-zinc-900">never sell</span> personal data to third
            parties.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">6. Data Retention</h2>
          <p className="text-sm leading-relaxed text-zinc-700">
            We retain personal data for as long as necessary to provide the service, and no longer
            than <span className="font-medium text-zinc-900">12 months</span> after your last
            interaction, unless:
          </p>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-zinc-700">
            <li>A deletion request is submitted (see Section 7)</li>
            <li>Longer retention is required by law</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">7. Your Rights</h2>
          <p className="text-sm leading-relaxed text-zinc-700">You have the right to:</p>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-zinc-700">
            <li>
              <span className="font-medium text-zinc-900">Access</span> — request a copy of data we
              hold about you
            </li>
            <li>
              <span className="font-medium text-zinc-900">Rectification</span> — request correction
              of inaccurate data
            </li>
            <li>
              <span className="font-medium text-zinc-900">Erasure</span> — request deletion of your
              data
            </li>
            <li>
              <span className="font-medium text-zinc-900">Restriction</span> — request we limit
              processing of your data
            </li>
            <li>
              <span className="font-medium text-zinc-900">Objection</span> — object to processing
              based on legitimate interests
            </li>
          </ul>
          <p className="text-sm font-medium text-zinc-900">To exercise your rights:</p>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-zinc-700">
            <li>
              Email:{" "}
              <a className={linkClass} href="mailto:office@heyzoe.io">
                office@heyzoe.io
              </a>
            </li>
            <li>
              Or send the word{" "}
              <span className="font-medium text-zinc-900" dir="rtl" lang="he">
                הסר
              </span>{" "}
              in your WhatsApp conversation with Zoe
            </li>
          </ul>
          <p className="text-sm leading-relaxed text-zinc-700">
            We will respond within <span className="font-medium text-zinc-900">30 days</span>.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">8. Data Security</h2>
          <p className="text-sm leading-relaxed text-zinc-700">
            We implement industry-standard security measures including:
          </p>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-zinc-700">
            <li>Encryption of data in transit (TLS) and at rest</li>
            <li>Access controls limiting data access to authorized personnel only</li>
            <li>Regular security reviews</li>
            <li>Secure cloud infrastructure (Supabase, Vercel)</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">9. International Data Transfers</h2>
          <p className="text-sm leading-relaxed text-zinc-700">
            Your data may be processed in countries outside Israel or the EU (including the United
            States), where our service providers operate. We ensure appropriate safeguards are in
            place in accordance with applicable data protection laws.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">10. Children&apos;s Privacy</h2>
          <p className="text-sm leading-relaxed text-zinc-700">
            Our service is not directed to children under the age of 16. We do not knowingly collect
            personal data from minors. If you believe we have inadvertently collected data from a
            child, please contact us at{" "}
            <a className={linkClass} href="mailto:office@heyzoe.io">
              office@heyzoe.io
            </a>{" "}
            and we will delete it promptly.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">11. Changes to This Policy</h2>
          <p className="text-sm leading-relaxed text-zinc-700">
            We may update this Privacy Policy from time to time. When we do, we will update the
            &quot;Last updated&quot; date at the top. Continued use of our service after changes
            constitutes acceptance of the updated policy.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">12. Applicable Law</h2>
          <p className="text-sm leading-relaxed text-zinc-700">
            This policy is governed by the laws of the{" "}
            <span className="font-medium text-zinc-900">State of Israel</span>, including the
            Protection of Privacy Law, 5741-1981. Users in the EU may also have rights under the{" "}
            <span className="font-medium text-zinc-900">GDPR</span>.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-zinc-900">13. Contact Us</h2>
          <p className="text-sm leading-relaxed text-zinc-700">
            For any privacy-related questions or requests:
          </p>
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
