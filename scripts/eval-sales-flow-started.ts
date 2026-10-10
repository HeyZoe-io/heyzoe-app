/**
 * Eval only. Free text from a lead already in a sales flow: before (flow state read as false
 * after the pre-Claude block broke early) vs after (flow state loaded once per turn).
 * Production generation (claude-haiku-5-5, effort low), then the same post-Claude decisions the webhook makes.
 * Does not send WhatsApp, write rows, or call webhooks or crons. SELECT only.
 * Outputs stay in gitignored eval-output/. Phones and emails are masked.
 *
 *   npx tsx --env-file=.env.local scripts/eval-sales-flow-started.ts run
 *   npx tsx --env-file=.env.local scripts/eval-sales-flow-started.ts judge
 *   npx tsx --env-file=.env.local scripts/eval-sales-flow-started.ts report
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { resolveClaudeApiKey } from "@/lib/claude";
import { buildHaikuRequest, claudeTextBlocks } from "@/lib/ai-models";
import { buildSystemPrompt, getBusinessKnowledgePack, type BusinessKnowledgePack } from "@/lib/business-context";
import { loadZoePlatformGuidelines } from "@/lib/business-zoe-platform";
import { inferLeadAgeBandFromUserTexts } from "@/lib/wa-lead-audience";
import { buildIsraelNowSchedulePromptBlock } from "@/lib/wa-relative-day-class-slots";
import { collectPreClaudeHint } from "@/lib/wa-pre-claude-hint";
import { formatFastPathHintLine } from "@/lib/wa-fast-path-hint";
import { extractReplyRoute } from "@/lib/wa-reply-route";
import { SALES_FLOW_GREETING_RESET_MODELS } from "@/lib/analytics";
import { sessionCountsAsSalesFlowStarted } from "@/lib/sales-flow-start-triggers";
import { WA_FOLLOWUP_CYCLE_RESET_MS } from "@/lib/wa-followup-cycle-reset";
import { resolveSendBeforeClaudeReason, isWholeMessageOpeningTrigger, wholeMessageMatchesLabel } from "@/lib/wa-send-before-claude";
import { collectSalesFlowCtaChoiceLabels } from "@/lib/wa-cta-compact";
import { resolveBusinessContentLanguageFromKnowledge } from "@/lib/business-content-lang";
import { isStudioOverviewIntentText } from "@/lib/wa-studio-overview-intent";
import { isStandaloneWhatsAppOpenQuestion, interestFlowPreamble, looksLikeLeadQuestion, stripTrailingFollowUpQuestion, finalizeStandaloneHelpReply, ensureRegisteredOpenQuestionClosing } from "@/lib/wa-split-answer";
import { claudeSignupTagMayOpenSalesFlow } from "@/lib/wa-warmup-skip-intent";
import {
  composeFindClassOffer,
  isFindClassBridgeModel,
  resolveFindClassLang,
  resolveInterestQuestionAnswer,
  shouldOfferFindClassBeforeFlow,
  shouldReaskFindClassBridge,
} from "@/lib/wa-interest-find-class";
import {
  findClassOfferGateOpen,
  interestRouteOpensFlow,
  memberMayEnterHintedSignupFlow,
  salesFlowOpenForTurn,
} from "@/lib/wa-turn-sales-flow-state";

const OUT = path.join(process.cwd(), "eval-output");
const BUDGET = 3;
const SAMPLES = 3;
const SPEND = "sfs-spend.jsonl";

type Group = "incident" | "mined" | "control";
const CASES: { id: string; label: string; group: Group }[] = [
  { id: "a714ed09-bee2-4d34-8f13-c578ad166277", label: "oria-2056", group: "incident" },
  { id: "1e9d62e1-a95b-4d59-9360-0d0d078b2a53", label: "oria-2100", group: "incident" },
  { id: "c7840999-7155-4da7-81fb-7098d018eb34", label: "oria-superpharm", group: "incident" },
  { id: "a68991b9-8790-4cbf-bfde-7ccd4d15cb6e", label: "m-limitless-1", group: "mined" },
  { id: "24348d71-c0c5-4bf1-a063-9380832a7810", label: "m-acro-1", group: "mined" },
  { id: "df4dbcce-c6dd-4740-be7d-8c35b8ffbbc9", label: "m-yigal", group: "mined" },
  { id: "0f673742-52db-4d7c-8720-5c32c8a67f35", label: "m-limitless-2", group: "mined" },
  { id: "e0e26448-1913-4787-a8f3-13a11a1c3487", label: "m-tights-1", group: "mined" },
  { id: "bae6bf40-90b3-4346-9f23-2aafa7d9ed71", label: "m-tights-2", group: "mined" },
  { id: "e9ed9853-c1dd-40e1-89e0-f3489941ef41", label: "m-acro-2", group: "mined" },
  { id: "68bda935-1feb-4ec2-bd20-9ce45dbf40fc", label: "m-omers", group: "mined" },
  { id: "51eab73d-9236-4da8-89d3-2d54d777c45f", label: "m-oria-018", group: "mined" },
  { id: "edb7c08f-e05d-4f66-90e7-b916a729ee79", label: "c1", group: "control" },
  { id: "270c9a1c-1895-4e69-8bd5-f9fa4880cca2", label: "c2", group: "control" },
  { id: "9711c596-7405-43da-81d2-80ad6090d29d", label: "c3", group: "control" },
  { id: "39a1e6e0-c263-40d6-8ae3-965a03d77610", label: "c4", group: "control" },
  { id: "a1281ec7-2a97-4281-9bd5-5a0b3820cbb9", label: "c5", group: "control" },
  { id: "981a06e1-e306-491e-b0f0-ee488d1a07f4", label: "c6", group: "control" },
  { id: "92163b35-cbbf-48de-b1c2-133210176e44", label: "c7", group: "control" },
  { id: "b8958a57-856a-44f4-966e-0d0bcc09f1cd", label: "c8", group: "control" },
  { id: "ed2dcc91-3bbc-4e8f-8dfa-58654c3dad61", label: "c9", group: "control" },
  { id: "8841980f-8fb5-4544-aef4-32af103a3937", label: "c10", group: "control" },
  { id: "b512f124-2d9d-432a-bd6d-c94f3053565e", label: "c11", group: "control" },
  { id: "412a14f5-bf1b-48ed-80ab-6149819a10e9", label: "c12", group: "control" },
  { id: "a21f9685-e2c4-4f87-bd0a-0f3d8104c2fd", label: "c13", group: "control" },
  { id: "f892d6aa-c56f-4502-89a7-1a1b3c2c4e7b", label: "c14", group: "control" },
  { id: "ba127076-946a-4a40-a86a-defea62a53e5", label: "c15", group: "control" },
];

type Msg = { id: string; created_at: string; business_slug: string; session_id: string | null; role: string; model_used: string | null; content: string | null };
type Action = "answer" | "find_class_offer" | "flow_reentry" | "hint_flow_entry";
type Sample = { route: string | null; action: Action; outbound: string };
type Side = { flowStarted: boolean; flowOpen: boolean; samples: Sample[] };
type RunRow = { label: string; group: Group; context: string; latest: string; inFlowAtTurn: boolean; skipped: boolean; before: Side; after: Side };

const admin = createSupabaseAdminClient();

function mask(text: string): string {
  return String(text ?? "")
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/(?<!\d)(?:\+972|972|0)\d(?:[-\s]?\d){7,8}(?!\d)/g, "[phone]")
    .replace(/\s+/g, " ")
    .trim();
}

function spent(): number {
  try {
    return readFileSync(path.join(OUT, SPEND), "utf8")
      .split("\n")
      .filter((line) => line.trim())
      .reduce((sum, line) => sum + (Number(JSON.parse(line).cost) || 0), 0);
  } catch {
    return 0;
  }
}

function note(cost: number, model: string, usage: { input: number; output: number }): void {
  mkdirSync(OUT, { recursive: true });
  appendFileSync(path.join(OUT, SPEND), `${JSON.stringify({ cost, model, ...usage })}\n`);
}

/** USD per million tokens, as verified in eval-wa-hebrew-model-compare.ts (prompts here stay under 200k). */
const haikuCost = (i: number, o: number) => (i * 0.1 + o * 0.5) / 1e6;
const sonnetCost = (i: number, o: number) => (i * 2 + o * 10) / 1e6;

function usageOf(json: Record<string, unknown>): { input: number; output: number } {
  const usage = (json.usage ?? {}) as { input_tokens?: number; output_tokens?: number };
  return { input: Number(usage.input_tokens ?? 0), output: Number(usage.output_tokens ?? 0) };
}

async function anthropic(apiKey: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  let last = "";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    if (res.status === 429 || res.status === 529 || res.status >= 500) {
      last = `Claude ${res.status}`;
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`Claude ${res.status}: ${mask(raw).slice(0, 240)}`);
    return JSON.parse(raw) as Record<string, unknown>;
  }
  throw new Error(last || "Claude failed");
}

function sessionQuery(row: Msg, beforeIso: string) {
  return admin
    .from("messages")
    .select("id, created_at, business_slug, session_id, role, model_used, content")
    .eq("business_slug", row.business_slug)
    .eq("session_id", row.session_id!)
    .lt("created_at", beforeIso)
    .order("created_at", { ascending: false })
    .limit(1);
}
type SessionQuery = ReturnType<typeof sessionQuery>;

async function lastBefore(row: Msg, beforeIso: string, filter: (q: SessionQuery) => SessionQuery): Promise<Msg | null> {
  const { data, error } = await filter(sessionQuery(row, beforeIso)).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Msg | null) ?? null;
}

/** sessionHasSalesFlowGreeting, bounded to messages before the inbound. */
async function flowStartedBefore(row: Msg): Promise<boolean> {
  const marker = await lastBefore(row, row.created_at, (q) => q.eq("role", "assistant").in("model_used", [...SALES_FLOW_GREETING_RESET_MODELS]));
  const preceding = marker ? await lastBefore(row, marker.created_at, (q) => q.eq("role", "user")) : null;
  const lastAssist = await lastBefore(row, row.created_at, (q) => q.eq("role", "assistant"));
  return sessionCountsAsSalesFlowStarted({
    greetingMarkerModel: marker?.model_used ?? null,
    precedingUserText: preceding?.content ?? null,
    lastAssistantModel: lastAssist?.model_used ?? null,
  });
}

type Contact = { arbox_is_member: boolean | null; trial_registered: boolean | null; human_requested_at: string | null; trial_signup_notice: string | null };

async function contactAt(slug: string, sessionId: string, at: string): Promise<{ contact: Contact; businessId: number | null }> {
  const { data: biz } = await admin.from("businesses").select("id").eq("slug", slug).maybeSingle();
  const businessId = (biz as { id?: number } | null)?.id ?? null;
  const phone = sessionId.split("_").pop() ?? "";
  const empty: Contact = { arbox_is_member: null, trial_registered: null, human_requested_at: null, trial_signup_notice: null };
  if (!businessId || !phone) return { contact: empty, businessId };
  const { data } = await admin
    .from("contacts")
    .select("arbox_is_member, trial_registered, human_requested_at, trial_signup_notice")
    .eq("business_id", businessId)
    .eq("phone", phone)
    .maybeSingle();
  const c = (data as Contact | null) ?? empty;
  const humanAt = c.human_requested_at && c.human_requested_at < at ? c.human_requested_at : null;
  return { contact: { ...c, human_requested_at: humanAt }, businessId };
}

function phaseFrom(lastAssistModel: string | null): string {
  const m = String(lastAssistModel ?? "");
  if (/sales_flow_cta|sf_cta/.test(m)) return "cta";
  if (/schedule_slot_menu/.test(m)) return "schedule_time";
  return "opening";
}

async function decide(input: {
  pack: BusinessKnowledgePack;
  slug: string;
  text: string;
  flowStarted: boolean;
  reopened: boolean;
  contact: Contact;
  phase: string;
  lastAssistModel: string | null;
  parsed: { route: string | null; tagStatus: string; body: string };
  hint: string | null;
  registered: boolean;
  openQuestionAi: boolean;
  standalone: boolean;
}): Promise<{ action: Action; outbound: string }> {
  const { pack, text, parsed, contact } = input;
  const flowOpen = salesFlowOpenForTurn({ salesFlowStarted: input.flowStarted, inboundReopenedAfterDormancy: input.reopened });
  const blockers = { arboxIsMember: contact.arbox_is_member, trialRegistered: contact.trial_registered, sessionPhase: input.phase };
  if (
    (input.hint === "signup" || input.hint === "registration_no_member") &&
    pack.salesFlowConfig &&
    memberMayEnterHintedSignupFlow({ arboxIsMember: contact.arbox_is_member, salesFlowStarted: input.flowStarted })
  ) {
    return { action: "hint_flow_entry", outbound: "[Zoe restarts the sales flow: the class-type picker «איזה סוג אימון הכי מסקרן אותך?» is sent]" };
  }
  let held = false;
  if (
    findClassOfferGateOpen({
      ...blockers,
      flowOpen,
      isText: true,
      hasBusiness: true,
      hasSalesFlowConfig: Boolean(pack.salesFlowConfig),
      routeTagOk: parsed.tagStatus === "ok",
    })
  ) {
    const explicit = parsed.route !== "signup" || claudeSignupTagMayOpenSalesFlow(text);
    const offerNow = shouldOfferFindClassBeforeFlow({ route: parsed.route, inbound: text, explicitSignup: explicit });
    const reask =
      !offerNow &&
      shouldReaskFindClassBridge({ route: parsed.route, inbound: text }) &&
      looksLikeLeadQuestion(text) &&
      isFindClassBridgeModel(input.lastAssistModel);
    const noticeBlocks = (offerNow || reask) && ["zoe", "template"].includes(String(contact.trial_signup_notice ?? ""));
    if (noticeBlocks) held = offerNow;
    if ((offerNow || reask) && !noticeBlocks) {
      held = offerNow;
      const answer = resolveInterestQuestionAnswer({
        inbound: text,
        claudeBody: parsed.body,
        services: (pack.salesFlowServices ?? []).map((s) => ({ name: s.name, priceText: s.priceText })),
        address: String(pack.addressText ?? ""),
      });
      if (answer) {
        return {
          action: "find_class_offer",
          outbound: composeFindClassOffer(answer, resolveFindClassLang(text, resolveBusinessContentLanguageFromKnowledge(pack))),
        };
      }
    }
  }
  if (parsed.tagStatus === "ok" && (parsed.route === "signup" || parsed.route === "interest")) {
    const explicit = parsed.route !== "signup" || claudeSignupTagMayOpenSalesFlow(text);
    if (interestRouteOpensFlow({ ...blockers, explicitSignup: explicit, flowOpen, heldForQuestion: held }) && pack.salesFlowConfig) {
      const preamble = interestFlowPreamble(text, parsed.body, String(pack.addressText ?? ""));
      return {
        action: "flow_reentry",
        outbound: `${preamble ? `${preamble}\n` : ""}[Zoe restarts the sales flow: the class-type picker «איזה סוג אימון הכי מסקרן אותך?» is sent]`,
      };
    }
  }
  let body = parsed.body;
  if (input.openQuestionAi && !input.registered) body = stripTrailingFollowUpQuestion(body);
  else if (input.registered) body = looksLikeLeadQuestion(text) ? ensureRegisteredOpenQuestionClosing(body) : stripTrailingFollowUpQuestion(body);
  else if (input.standalone) body = finalizeStandaloneHelpReply(body, text);
  const resend = input.openQuestionAi && !input.registered && input.phase !== "cta";
  return { action: "answer", outbound: `${body}${resend ? "\n[then Zoe re-sends the flow step the lead was on]" : ""}` };
}

async function run(): Promise<void> {
  const apiKey = resolveClaudeApiKey();
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
  const guidelines = await loadZoePlatformGuidelines();
  const params = buildHaikuRequest("wa-generation", "claude-haiku-5-5");
  const packs = new Map<string, BusinessKnowledgePack | null>();
  const only = (process.env.SFS_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const results: RunRow[] = [];
  for (const item of only.length ? CASES.filter((c) => only.includes(c.label)) : CASES) {
    if (spent() > BUDGET) throw new Error("budget cap");
    const { data, error } = await admin
      .from("messages")
      .select("id, created_at, business_slug, session_id, role, model_used, content")
      .eq("id", item.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const stored = data as Msg | null;
    const row =
      stored?.session_id && stored.role === "assistant"
        ? await lastBefore(stored, stored.created_at, (q) => q.eq("role", "user"))
        : stored;
    if (!row?.session_id || row.role !== "user") {
      console.log(`skip ${item.label}`);
      continue;
    }
    if (!packs.has(row.business_slug)) packs.set(row.business_slug, await getBusinessKnowledgePack(row.business_slug));
    const pack = packs.get(row.business_slug);
    if (!pack) continue;
    const { data: historyRows, error: historyError } = await admin
      .from("messages")
      .select("id, created_at, business_slug, session_id, role, model_used, content")
      .eq("business_slug", row.business_slug)
      .eq("session_id", row.session_id)
      .lt("created_at", row.created_at)
      .order("created_at", { ascending: false })
      .limit(10);
    if (historyError) throw new Error(historyError.message);
    const prior = ((historyRows ?? []) as Msg[]).slice().reverse().filter((t) => t.role === "user" || t.role === "assistant");
    const text = String(row.content ?? "").trim();
    const at = new Date(row.created_at);
    const lang = resolveBusinessContentLanguageFromKnowledge(pack);
    const labels = [
      ...(pack.salesFlowServices ?? []).map((s) => s.name),
      ...(pack.salesFlowConfig ? collectSalesFlowCtaChoiceLabels(pack.salesFlowConfig, lang) : []),
    ];
    const skipped =
      resolveSendBeforeClaudeReason({
        text,
        openingTrigger: isWholeMessageOpeningTrigger(text, { slug: row.business_slug, businessName: pack.businessName }),
        matchesMenuLabel: wholeMessageMatchesLabel(text, labels),
        warmupOption: false,
      }) === null;
    const inFlow = await flowStartedBefore(row);
    const lastAssist = await lastBefore(row, row.created_at, (q) => q.eq("role", "assistant"));
    const prevAny = await lastBefore(row, row.created_at, (q) => q.neq("role", "event"));
    const reopened = !prevAny || at.getTime() - Date.parse(prevAny.created_at) >= WA_FOLLOWUP_CYCLE_RESET_MS;
    const { contact } = await contactAt(row.business_slug, row.session_id, row.created_at);
    const phase = phaseFrom(lastAssist?.model_used ?? null);
    const registered = contact.trial_registered === true || Boolean(contact.human_requested_at);
    const hint = collectPreClaudeHint(text)?.category ?? null;
    const hintLine = hint ? formatFastPathHintLine({ matcher: "stored", category: hint }) : "";
    const userContent = `${text}${hintLine ? `\n\n${hintLine}` : ""}\n\nהשורה הראשונה בתשובתך חייבת להיות [[route:X]] ורק אחריה הטקסט ללקוחה.`;
    const messages = [
      ...prior.map((t) => ({ role: t.role as "user" | "assistant", content: String(t.content ?? "").slice(0, 4000) })),
      { role: "user" as const, content: userContent },
    ];
    const sides: Record<"before" | "after", Side> = {
      before: { flowStarted: skipped ? false : inFlow, flowOpen: false, samples: [] },
      after: { flowStarted: inFlow, flowOpen: false, samples: [] },
    };
    for (const side of ["before", "after"] as const) {
      const flowStarted = sides[side].flowStarted;
      const flowOpen = salesFlowOpenForTurn({ salesFlowStarted: flowStarted, inboundReopenedAfterDormancy: reopened });
      sides[side].flowOpen = flowOpen;
      const standalone = isStandaloneWhatsAppOpenQuestion({ sessionPhase: phase, salesFlowStarted: flowStarted, registered });
      const openQuestionAi = Boolean(pack.salesFlowConfig) && !standalone;
      const system = buildSystemPrompt(
        pack,
        row.business_slug,
        "whatsapp",
        {
          sessionPhase: phase as never,
          trialRegistered: contact.trial_registered === true,
          suppressFollowUpQuestion: openQuestionAi && !registered,
          registeredOpenQuestionHelpClosing: openQuestionAi && registered,
          standaloneHelpClosing: standalone,
          studioOverviewClosing: standalone && isStudioOverviewIntentText(text),
          israelNowScheduleBlock: buildIsraelNowSchedulePromptBlock(pack.salesFlowServices ?? [], at),
          leadAgeBand: inferLeadAgeBandFromUserTexts([...prior.filter((t) => t.role === "user").map((t) => String(t.content ?? "")), text]),
          salesFlowCurrentlyOpen: flowOpen,
        },
        guidelines,
        text
      );
      for (let s = 0; s < SAMPLES; s += 1) {
        if (spent() > BUDGET) throw new Error("budget cap");
        const json = await anthropic(apiKey, { ...params, system, messages });
        const usage = usageOf(json);
        note(haikuCost(usage.input, usage.output), "claude-haiku-5-5", usage);
        const parsed = extractReplyRoute(claudeTextBlocks(json as { content?: unknown }));
        const decision = await decide({
          pack,
          slug: row.business_slug,
          text,
          flowStarted,
          reopened,
          contact,
          phase,
          lastAssistModel: lastAssist?.model_used ?? null,
          parsed: { route: parsed.route, tagStatus: parsed.tagStatus, body: parsed.body },
          hint,
          registered,
          openQuestionAi,
          standalone,
        });
        sides[side].samples.push({ route: parsed.route, action: decision.action, outbound: mask(decision.outbound).slice(0, 900) });
      }
    }
    const context = prior
      .slice(-6)
      .map((t) => `${t.role === "user" ? "Lead" : "Zoe"}: ${mask(String(t.content ?? "")).slice(0, 300)}`)
      .join("\n");
    results.push({ label: item.label, group: item.group, context, latest: mask(text), inFlowAtTurn: inFlow && !reopened, skipped, before: sides.before, after: sides.after });
    console.log(`ran ${item.label} inFlow=${inFlow} skipped=${skipped} spent $${spent().toFixed(4)}`);
    writeFileSync(path.join(OUT, "sfs-runs.json"), JSON.stringify({ results }, null, 2));
  }
  writeFileSync(path.join(OUT, "sfs-runs.json"), JSON.stringify({ results }, null, 2));
}

type Verdict = { flow_reopened_wrongly: boolean; offer_repeated_wrongly: boolean; answered_latest_message: boolean };

async function judge(): Promise<void> {
  const apiKey = resolveClaudeApiKey();
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
  const file = JSON.parse(readFileSync(path.join(OUT, "sfs-runs.json"), "utf8")) as { results: RunRow[] };
  const judged: (RunRow & { verdicts: Record<"before" | "after", Verdict[]> })[] = [];
  for (const row of file.results) {
    const verdicts: Record<"before" | "after", Verdict[]> = { before: [], after: [] };
    for (const side of ["before", "after"] as const) {
      for (const sample of row[side].samples) {
        if (spent() > BUDGET) throw new Error("budget cap");
        let parsed: Verdict | null = null;
        for (let attempt = 0; attempt < 3 && !parsed; attempt += 1) {
          const json = await anthropic(apiKey, {
            model: "claude-sonnet-5-5",
            max_tokens: 400,
            output_config: { effort: "low" },
            messages: [
              {
                role: "user",
                content: `Judge what Zoe (a studio's WhatsApp assistant) sent in reply to the lead's latest message. JSON only, no markdown:
{"flow_reopened_wrongly":false,"offer_repeated_wrongly":false,"answered_latest_message":true}
flow_reopened_wrongly: true when Zoe restarted the sales flow from the class-type picker although the lead was already in the flow or only asked a factual question. Re-sending the step the lead was on is not a restart.
offer_repeated_wrongly: true when Zoe asked «רוצה שנמצא את השיעור המתאים עבורך?» (or the same offer) although the lead was already in a sales flow or Zoe had just asked it.
answered_latest_message: true when the reply actually addresses what the latest message asked or said.
Lead already in a sales flow before this message: ${row.inFlowAtTurn ? "yes" : "no"}
Conversation before:
${row.context}
Latest lead message: ${row.latest}
What Zoe sent:
${sample.outbound}`,
              },
            ],
          });
          const usage = usageOf(json);
          note(sonnetCost(usage.input, usage.output), "claude-sonnet-5-5", usage);
          const text = claudeTextBlocks(json as { content?: unknown });
          const start = text.indexOf("{");
          const end = text.lastIndexOf("}");
          if (start < 0 || end <= start) continue;
          try {
            parsed = JSON.parse(text.slice(start, end + 1)) as Verdict;
          } catch {
            parsed = null;
          }
        }
        verdicts[side].push(parsed ?? { flow_reopened_wrongly: false, offer_repeated_wrongly: false, answered_latest_message: false });
      }
    }
    judged.push({ ...row, verdicts });
    console.log(`judged ${row.label} spent $${spent().toFixed(4)}`);
    writeFileSync(path.join(OUT, "sfs-judge.json"), JSON.stringify({ judged }, null, 2));
  }
}

function report(): void {
  const { judged } = JSON.parse(readFileSync(path.join(OUT, "sfs-judge.json"), "utf8")) as {
    judged: (RunRow & { verdicts: Record<"before" | "after", Verdict[]> })[];
  };
  const groups: Group[] = ["incident", "mined", "control"];
  const lines = ["# salesFlowStarted replay", "", `Spend: $${spent().toFixed(4)}`, ""];
  for (const group of groups) {
    const rows = judged.filter((r) => r.group === group);
    const count = (side: "before" | "after", fn: (v: Verdict) => boolean) => rows.reduce((n, r) => n + r.verdicts[side].filter(fn).length, 0);
    const total = rows.reduce((n, r) => n + r.verdicts.before.length, 0);
    lines.push(`## ${group} (${rows.length} cases, ${total} samples per side)`);
    lines.push(`- flow_reopened_wrongly: before ${count("before", (v) => v.flow_reopened_wrongly)} → after ${count("after", (v) => v.flow_reopened_wrongly)}`);
    lines.push(`- offer_repeated_wrongly: before ${count("before", (v) => v.offer_repeated_wrongly)} → after ${count("after", (v) => v.offer_repeated_wrongly)}`);
    lines.push(`- answered_latest_message missed: before ${count("before", (v) => !v.answered_latest_message)} → after ${count("after", (v) => !v.answered_latest_message)}`);
    lines.push("");
  }
  lines.push("## Per case");
  for (const r of judged) {
    const acts = (side: "before" | "after") => r[side].samples.map((s) => s.action).join(",");
    lines.push(`- ${r.label} inFlow=${r.inFlowAtTurn} skipped=${r.skipped} before[${acts("before")}] after[${acts("after")}]`);
  }
  writeFileSync(path.join(OUT, "sfs-report.md"), lines.join("\n"));
  console.log(lines.join("\n"));
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (cmd === "run") return run();
  if (cmd === "judge") return judge();
  if (cmd === "report") return report();
  throw new Error("usage: run | judge | report");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "eval failed");
  process.exit(1);
});
