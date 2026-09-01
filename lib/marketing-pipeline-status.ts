import type { ContactStatusKey } from "@/lib/contact-status";
import type { LeadRow } from "@/lib/leads-types";
import type { MarketingNoteStatus } from "@/lib/marketing-conversation-notes";

export type MarketingPipelineDropStatus = ContactStatusKey | "none";

/** כל עמודות הפייפליין שאפשר לגרור אליהן בלי לשלוח הודעה לליד */
export const MARKETING_PIPELINE_DROP_STATUSES: readonly MarketingPipelineDropStatus[] = [
  "template",
  "active",
  "followup",
  "human_followup",
  "no_response",
  "human_requested",
  "registered_human_requested",
  "registered",
  "not_interested",
  "not_relevant",
  "opted_out",
  "none",
];

/** סטטוסים שסוגרים את הליד ב-CRM (הערות + עצירת פולואפים) */
export const MARKETING_PIPELINE_MANUAL_STATUSES = [
  "registered",
  "not_interested",
  "not_relevant",
  "no_response",
  "human_requested",
  "human_followup",
  "opted_out",
  "registered_human_requested",
] as const;

export type MarketingPipelineManualStatus = (typeof MARKETING_PIPELINE_MANUAL_STATUSES)[number];

const DROP_SET = new Set<string>(MARKETING_PIPELINE_DROP_STATUSES);
const MANUAL_SET = new Set<string>(MARKETING_PIPELINE_MANUAL_STATUSES);
const STOP_FOLLOWUPS = new Set<string>([
  "registered",
  "not_interested",
  "not_relevant",
  "no_response",
  "human_requested",
  "opted_out",
  "registered_human_requested",
]);

export function isMarketingPipelineDropStatus(v: unknown): v is MarketingPipelineDropStatus {
  return typeof v === "string" && DROP_SET.has(v);
}

export function isMarketingPipelineManualStatus(v: unknown): v is MarketingPipelineManualStatus {
  return typeof v === "string" && MANUAL_SET.has(v);
}

export function marketingNoteStatusToPipeline(
  status: string | null | undefined
): MarketingPipelineManualStatus | null {
  if (status === "registered") return "registered";
  if (status === "not_interested") return "not_interested";
  if (status === "not_relevant") return "not_relevant";
  if (status === "no_response") return "no_response";
  return null;
}

export function pipelineStatusToNoteStatus(
  status: MarketingPipelineDropStatus
): MarketingNoteStatus | null {
  if (status === "registered" || status === "registered_human_requested") return "registered";
  if (status === "not_interested") return "not_interested";
  if (status === "not_relevant") return "not_relevant";
  if (status === "no_response") return "no_response";
  if (status === "human_followup") return "requires_call";
  return null;
}

export function pipelineStatusStopsFollowups(status: MarketingPipelineDropStatus): boolean {
  return STOP_FOLLOWUPS.has(status);
}

function sessionPhaseWithoutRegistered(row: LeadRow): string | null {
  const phase = String(row.session_phase ?? "").trim();
  if (phase === "registered") return "cta";
  return row.session_phase ?? null;
}

/** מציב שדות כך שהכרטיס יישאר בעמודה שנבחרה */
export function applyManualPipelineStatus(
  row: LeadRow,
  status: MarketingPipelineDropStatus | null,
  atIso?: string | null
): LeadRow {
  if (!status) {
    return { ...row, pipeline_status: null };
  }
  const at = String(atIso ?? "").trim() || new Date().toISOString();
  const cleared: LeadRow = {
    ...row,
    opted_out: false,
    not_relevant_at: null,
    not_relevant_reason: null,
    human_requested_at: null,
    wa_no_response_at: null,
    trial_registered: false,
    session_phase: sessionPhaseWithoutRegistered(row),
    pipeline_status: status,
  };

  switch (status) {
    case "registered":
      return {
        ...cleared,
        trial_registered: true,
        session_phase: "registered",
        human_followup_at: null,
        next_call_at: null,
        next_call_time: null,
      };
    case "registered_human_requested":
      return {
        ...cleared,
        trial_registered: true,
        session_phase: "registered",
        human_requested_at: at,
        human_followup_at: null,
        next_call_at: null,
        next_call_time: null,
      };
    case "not_interested":
      return {
        ...cleared,
        human_followup_at: null,
        next_call_at: null,
        next_call_time: null,
      };
    case "not_relevant":
      return {
        ...cleared,
        not_relevant_at: at,
        human_followup_at: null,
        next_call_at: null,
        next_call_time: null,
      };
    case "no_response":
      return {
        ...cleared,
        wa_no_response_at: at,
        human_followup_at: null,
        next_call_at: null,
        next_call_time: null,
      };
    case "human_requested":
      return {
        ...cleared,
        human_requested_at: at,
        human_followup_at: null,
        next_call_at: null,
        next_call_time: null,
      };
    case "opted_out":
      return {
        ...cleared,
        opted_out: true,
        human_followup_at: null,
        next_call_at: null,
        next_call_time: null,
      };
    case "human_followup":
      return {
        ...cleared,
        human_followup_at: row.human_followup_at || at,
        next_call_at: row.next_call_at,
        next_call_time: row.next_call_time ?? null,
      };
    case "active":
    case "followup":
    case "template":
    case "none":
      return {
        ...cleared,
        human_followup_at: null,
        next_call_at: null,
        next_call_time: null,
      };
    default:
      return { ...cleared, pipeline_status: status };
  }
}

export type MarketingLeadStatusHints = {
  registeredFromMessage?: boolean;
  noteStatus?: string | null;
  noteUpdatedAt?: string | null;
  pipelineStatus?: string | null;
};

export function applyMarketingLeadStatusHints(row: LeadRow, hints: MarketingLeadStatusHints): LeadRow {
  let next: LeadRow = hints.registeredFromMessage
    ? { ...row, trial_registered: true, session_phase: "registered" }
    : row;
  const notePipeline = marketingNoteStatusToPipeline(hints.noteStatus);
  if (notePipeline) {
    next = applyManualPipelineStatus(next, notePipeline, hints.noteUpdatedAt);
    next = {
      ...next,
      pipeline_status: isMarketingPipelineDropStatus(row.pipeline_status)
        ? row.pipeline_status
        : notePipeline === "not_interested"
          ? "not_interested"
          : null,
    };
  }
  const pipeline = isMarketingPipelineDropStatus(hints.pipelineStatus) ? hints.pipelineStatus : null;
  if (pipeline) {
    next = applyManualPipelineStatus(next, pipeline, hints.noteUpdatedAt);
  }
  return next;
}

export function isMarketingPipelineDropTarget(
  status: ContactStatusKey | "none" | string | null | undefined
): status is MarketingPipelineDropStatus {
  return isMarketingPipelineDropStatus(status);
}
