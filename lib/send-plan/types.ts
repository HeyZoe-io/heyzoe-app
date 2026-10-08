/**
 * The PLAN handle the daily run context carries. Types only, so the client-safe
 * context bridge (lib/leads/arbox-daily-run-flag.ts) can name it without server imports.
 */
export type PlanSendInput = {
  to: string;
  phoneNumberId: string;
  templateName: string;
  languageCode?: string;
  components?: Array<{ type: "body" | "header"; parameters: Array<{ type: "text"; text: string }> }>;
  recipientKind?: "customer" | "staff";
  alertTriggerId?: string | null;
  eventDedupKey?: string | null;
};

export type PlanLogInput = {
  business_slug: string;
  role: string;
  content: string;
  model_used?: string | null;
  session_id?: string | null;
};

export type PlanEnqueueInput = {
  businessId: number;
  triggerId: string;
  contactPhone: string;
  templateName: string;
  dedupKey: string;
  dueAt: Date;
  recipientKind?: "customer" | "staff";
};

export type SendPlanHandle = {
  readonly slot: "morning" | "evening";
  readonly planDay: string;
  readonly dispatchAt: Date;
  readonly businessId: number;
  readonly dryRun: boolean;
  /** true in PLAN. false in a legacy run, where only queued rows are checked. */
  readonly intercepts: boolean;
  /** sendBusinessTemplate inside PLAN: write the item instead of calling Meta. */
  record(input: PlanSendInput): Promise<{ ok: boolean; error?: string }>;
  /** A queued row written during PLAN, checked in finalize. */
  noteEnqueue(input: PlanEnqueueInput): void;
  /** A due time before DISPATCH moves by the same distance, so nothing drains before it. */
  shiftDue(dueAt: Date): Date;
  /** logMessage right after a planned send: kept on the row, logged when DISPATCH sends. */
  captureLog(entry: PlanLogInput): boolean;
};
