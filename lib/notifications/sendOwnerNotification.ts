import { resolveMetaAccessToken } from "@/lib/whatsapp";
import { outboundSendsHeld } from "@/lib/business-sends-hold";
import { isArboxDailyDryRun, noteArboxDailyWouldSend } from "@/lib/leads/arbox-daily-run-flag";
import {
  contactAlertMuted,
  graphTemplateMessageId,
  lookupBusinessIdByPhoneNumberId,
  recordTemplateSendRef,
  SUPPRESSED_ALERT_MUTE_ERROR,
} from "@/lib/contact-alert-mute";
import {
  evaluateLeadTemplateSendByPhoneNumberId,
  SUPPRESSED_OPT_OUT_ERROR,
  suppressMarketingOptOutFromSendError,
} from "@/lib/wa-marketing-opt-out";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { DUPLICATE_GUARD_ERROR } from "@/lib/notifications/template-duplicate-guard";
import {
  claimTemplateSend,
  releaseTemplateSendClaim,
  type TemplateSendClaim,
} from "@/lib/notifications/template-send-claim";
import {
  postWhatsAppGraphMessage,
  SEND_OUTCOME_UNKNOWN,
  sendErrorBodyIsExplicit,
  thrownSendOutcome,
} from "@/lib/notifications/graph-whatsapp-send";
import { formatMetaSendError, recordTemplateSendFailure } from "@/lib/meta-send-error";
import { sanitizeZoeOutboundDeep } from "@/lib/zoe-text";
import { applyStudioPurpleHeartPolicyDeep } from "@/lib/wa-studio-purple-heart";
import { EMPTY_VARIABLE_ERROR, emptyTemplateVariable } from "@/lib/notifications/template-empty-variable";

export type OwnerTemplateComponent = {
  type: "body" | "header";
  parameters: Array<{ type: "text"; text: string }>;
};

function resolveZoeMasterPhoneNumberId(): string {
  return (
    process.env.ZOEMASTER_PHONE_NUMBER_ID?.trim() ||
    process.env.MARKETING_WA_PHONE_NUMBER_ID?.trim() ||
    "1179786855208358"
  );
}

/**
 * שולח הודעת template לבעל העסק ממספר זואי הראשי (ZOEMASTER_PHONE_NUMBER_ID).
 */
export async function sendOwnerNotification(input: {
  ownerPhone: string;
  templateName: string;
  languageCode?: string;
  components?: OwnerTemplateComponent[];
}): Promise<{ ok: boolean; error?: string }> {
  const token = resolveMetaAccessToken();
  if (!token) {
    return { ok: false, error: "missing_meta_token" };
  }

  const phoneNumberId = resolveZoeMasterPhoneNumberId();
  const to = String(input.ownerPhone ?? "").replace(/\D/g, "");
  if (!to) return { ok: false, error: "missing_owner_phone" };

  const templateName = String(input.templateName ?? "").trim();
  if (!templateName) return { ok: false, error: "missing_template" };

  const empty = emptyTemplateVariable(input.components);
  if (empty) {
    console.error("[sendOwnerNotification] empty template variable, not sent", { templateName, empty });
    await recordTemplateSendFailure({
      phoneNumberId,
      phone: to,
      templateName,
      metaError: `${EMPTY_VARIABLE_ERROR}: ${empty}`,
      raw: "",
    }).catch((e) => console.error("[sendOwnerNotification] failure log failed:", e));
    return { ok: false, error: EMPTY_VARIABLE_ERROR };
  }

  const body: Record<string, unknown> = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: input.languageCode?.trim() || "he" },
      ...(input.components?.length ? { components: sanitizeZoeOutboundDeep(input.components) } : {}),
    },
  };

  try {
    const res = await postWhatsAppGraphMessage({ phoneNumberId, to, token, body });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[sendOwnerNotification] Meta error:", res.status, errText);
      const formatted = formatMetaSendError(errText || `http_${res.status}`);
      await recordTemplateSendFailure({
        phoneNumberId,
        phone: to,
        templateName,
        metaError: formatted,
        raw: errText,
      }).catch((e) => console.error("[sendOwnerNotification] failure log failed:", e));
      return { ok: false, error: formatted };
    }
    try {
      const { logZoeAdminTemplateToConversations } = await import("@/lib/wa-zoe-admin-template-log");
      await logZoeAdminTemplateToConversations({
        toPhone: to,
        templateName,
        sendComponents: input.components,
      });
    } catch (e) {
      console.error("[sendOwnerNotification] conversation log failed:", e);
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sendOwnerNotification] failed:", msg);
    return { ok: false, error: msg };
  }
}

const BUSINESS_TEMPLATE_SEND_TIMEOUT_MS = 25_000;

/**
 * שולח הודעת template WhatsApp ממספר עסק (phone_number_id) — לא מ-ZoeMaster.
 */
export async function sendBusinessTemplate(input: {
  to: string;
  phoneNumberId: string;
  templateName: string;
  languageCode?: string;
  components?: OwnerTemplateComponent[];
  /** Drain already evaluated opt-out — skip a second contacts/templates lookup. */
  skipOptOutGate?: boolean;
  /** Staff recipient: skip customer opt-out and do not insert a contacts row on 131050. */
  recipientKind?: "customer" | "staff";
  /** template_triggers.id for this send. Empty = a template that is not a trigger. */
  alertTriggerId?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const token = resolveMetaAccessToken();
  if (!token) {
    return { ok: false, error: "missing_meta_token" };
  }

  const phoneNumberId = String(input.phoneNumberId ?? "").trim();
  if (!phoneNumberId) return { ok: false, error: "missing_phone_number_id" };

  const to = String(input.to ?? "").replace(/\D/g, "");
  if (!to) return { ok: false, error: "missing_recipient_phone" };

  const templateName = String(input.templateName ?? "").trim();
  if (!templateName) return { ok: false, error: "missing_template" };

  const isStaffRecipient = input.recipientKind === "staff";

  const empty = emptyTemplateVariable(input.components);
  if (empty) {
    console.error("[sendBusinessTemplate] empty template variable, not sent", {
      templateName,
      empty,
      phone: to.slice(-4),
      triggerId: input.alertTriggerId ?? null,
    });
    if (isArboxDailyDryRun()) return { ok: false, error: EMPTY_VARIABLE_ERROR };
    await recordTemplateSendFailure({
      phoneNumberId,
      phone: to,
      templateName,
      triggerId: input.alertTriggerId,
      metaError: `${EMPTY_VARIABLE_ERROR}: ${empty}`,
      raw: "",
    }).catch((e) => console.error("[sendBusinessTemplate] failure log failed:", e));
    return { ok: false, error: EMPTY_VARIABLE_ERROR };
  }

  if (!input.skipOptOutGate && !isStaffRecipient) {
    const gate = await evaluateLeadTemplateSendByPhoneNumberId({
      phoneNumberId,
      phone: to,
      templateName,
    });
    if (gate.suppress) {
      console.info("[sendBusinessTemplate] suppressed opt-out", {
        phoneNumberId,
        to,
        templateName,
      });
      return { ok: false, error: SUPPRESSED_OPT_OUT_ERROR };
    }
  }

  if (isArboxDailyDryRun()) {
    const params = (input.components ?? []).flatMap((component) =>
      component.type === "body" ? component.parameters.map((parameter) => parameter.text) : []
    );
    const line = {
      template: templateName,
      phone_tail: to.slice(-4),
      params,
    };
    noteArboxDailyWouldSend(line);
    console.info("[dry-run] template", line);
    return { ok: true };
  }

  if (
    await outboundSendsHeld({
      phoneNumberId,
      to,
      kind: "template",
      templateName,
      preview: templateName,
    })
  ) {
    return { ok: false, error: "sends_hold" };
  }

  let admin: ReturnType<typeof createSupabaseAdminClient> | null = null;
  let businessId: number | null = null;
  if (!isStaffRecipient) {
    try {
      admin = createSupabaseAdminClient();
      businessId = await lookupBusinessIdByPhoneNumberId(admin, phoneNumberId);
      if (businessId) {
        const muted = await contactAlertMuted({
          admin,
          businessId,
          phone: to,
          templateName,
          triggerId: input.alertTriggerId,
        });
        if (muted) {
          console.info("[sendBusinessTemplate] suppressed alert mute", {
            phoneNumberId,
            to,
            templateName,
            triggerId: input.alertTriggerId ?? null,
          });
          return { ok: false, error: SUPPRESSED_ALERT_MUTE_ERROR };
        }
      }
    } catch (e) {
      console.error("[sendBusinessTemplate] alert mute check failed:", e);
      admin = null;
      businessId = null;
    }
  }

  let claim: TemplateSendClaim = { kind: "unclaimed" };
  if (!isStaffRecipient && admin && businessId) {
    const params = (input.components ?? []).flatMap((component) =>
      component.type === "body" ? component.parameters.map((parameter) => parameter.text) : []
    );
    claim = await claimTemplateSend({
      admin,
      businessId,
      phoneNumberId,
      phone: to,
      templateName,
      params,
    }).catch((e): TemplateSendClaim => {
      console.error("[sendBusinessTemplate] duplicate guard failed", e);
      return { kind: "unclaimed" };
    });
    if (claim.kind === "duplicate") {
      console.info("[sendBusinessTemplate] duplicate_guard", {
        businessId,
        templateName,
        phone: to.slice(-4),
      });
      return { ok: false, error: DUPLICATE_GUARD_ERROR };
    }
  }

  const body: Record<string, unknown> = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: input.languageCode?.trim() || "he" },
      ...(input.components?.length
        ? {
            components: sanitizeZoeOutboundDeep(
              applyStudioPurpleHeartPolicyDeep(input.components, { fromNumber: phoneNumberId })
            ),
          }
        : {}),
    },
  };

  try {
    const res = await postWhatsAppGraphMessage({
      phoneNumberId,
      to,
      token,
      body,
      timeoutMs: BUSINESS_TEMPLATE_SEND_TIMEOUT_MS,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      if (!sendErrorBodyIsExplicit(errText)) {
        console.error("[sendBusinessTemplate] outcome unknown:", res.status, errText.slice(0, 300));
        return { ok: false, error: `${SEND_OUTCOME_UNKNOWN}:http_${res.status}` };
      }
      console.error("[sendBusinessTemplate] Meta error:", res.status, errText);
      if (admin) await releaseTemplateSendClaim(admin, claim);
      const formatted = formatMetaSendError(errText || `http_${res.status}`);
      await recordTemplateSendFailure({
        phoneNumberId,
        phone: to,
        templateName,
        triggerId: input.alertTriggerId,
        metaError: formatted,
        raw: errText,
      }).catch((e) => console.error("[sendBusinessTemplate] failure log failed:", e));
      if (!isStaffRecipient) {
        await suppressMarketingOptOutFromSendError({
          phoneNumberId,
          phone: to,
          errorText: errText,
        }).catch((e) =>
          console.error("[sendBusinessTemplate] marketing opt-out suppress failed:", e)
        );
      }
      return { ok: false, error: formatted };
    }
    const json = (await res.json().catch(() => null)) as unknown;
    const wamid = graphTemplateMessageId(json);
    if (!isStaffRecipient && admin && businessId && wamid) {
      await recordTemplateSendRef({
        admin,
        wamid,
        businessId,
        phone: to,
        templateName,
        triggerId: input.alertTriggerId,
      }).catch((e) => console.error("[sendBusinessTemplate] alert ref failed:", e));
    } else if (!isStaffRecipient && !wamid) {
      console.error("[sendBusinessTemplate] missing wamid — alert mute button cannot map this send", {
        templateName,
      });
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sendBusinessTemplate] failed:", msg);
    const explicit = thrownSendOutcome(e) === "explicit";
    if (explicit && admin) await releaseTemplateSendClaim(admin, claim);
    return { ok: false, error: explicit ? msg : `${SEND_OUTCOME_UNKNOWN}: ${msg}` };
  }
}
