type SendEmailInput = {
  to: string;
  subject: string;
  htmlContent: string;
};

function resolveBrevoApiKey(): string {
  return process.env.BREVO_API_KEY?.trim() ?? "";
}

export async function sendEmail(input: SendEmailInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = resolveBrevoApiKey();
  if (!apiKey) return { ok: false, error: "missing_brevo_api_key" };

  const to = String(input.to ?? "").trim();
  const subject = String(input.subject ?? "").trim();
  const htmlContent = String(input.htmlContent ?? "").trim();
  if (!to || !subject || !htmlContent) return { ok: false, error: "missing_fields" };

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: { name: "Hey Zoe", email: "noreply@heyzoe.io" },
      to: [{ email: to }],
      subject,
      htmlContent,
    }),
  });

  if (res.ok) return { ok: true };

  const text = await res.text().catch(() => "");
  let msg = text || `brevo_failed (${res.status})`;
  try {
    const j = text ? (JSON.parse(text) as any) : null;
    const brevoMsg = String(j?.message ?? j?.error ?? j?.code ?? "").trim();
    if (brevoMsg) msg = brevoMsg;
  } catch {
    // ignore
  }
  return { ok: false, error: msg };
}

