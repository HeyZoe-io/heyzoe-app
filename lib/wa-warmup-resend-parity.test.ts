import assert from "node:assert/strict";
import {
  decideWarmupExtraResendAction,
  inferWarmupExtraStepIndex,
  resolveWarmupResendExtraIdx,
} from "@/lib/wa-warmup-extra-resend";

type ResendIdxInput = {
  contactFlowStep: number;
  lastIdxFromEvent: number | null;
  lastAssistModel: string | null;
  hasWarmupQ1: boolean;
  cleanStepsCount: number;
};

/** Exact copy of resendUnansweredSalesFlowPrompt warmup idx resolution pre-extract. */
function legacyResendWarmupExtraIdx(input: ResendIdxInput): number | null {
  const fromActiveMenu = inferWarmupExtraStepIndex({
    flowStep: input.contactFlowStep,
    hasWarmupQ1: input.hasWarmupQ1,
    cleanStepsCount: input.cleanStepsCount,
    lastIdxFromEvent: input.lastIdxFromEvent,
    lastAssistModel: input.lastAssistModel,
    sessionPhase: "warmup",
  });
  let extraIdx = fromActiveMenu;
  if (extraIdx == null && input.cleanStepsCount > 0) {
    const fromStep = input.hasWarmupQ1 ? input.contactFlowStep - 1 : input.contactFlowStep;
    if (fromStep >= 0 && fromStep < input.cleanStepsCount) extraIdx = fromStep;
  }
  return extraIdx;
}

/** Route gate after idx resolution — unchanged in extract. */
function legacyWouldSendWarmupExtraResend(
  extraIdx: number | null,
  step: { question?: string; options?: string[] } | undefined
): boolean {
  return !!(step?.question && (step.options?.length ?? 0) >= 2);
}

type ParityCase = {
  name: string;
  input: ResendIdxInput;
  /** Documented legacy extraIdx (resolveActiveWarmupExtraMenuIndex + fromStep fallback). */
  legacyExtraIdx: number | null;
  /** Optional step fixture for min-options / last-step send gate. */
  stepFixture?: { question?: string; options?: string[] };
  legacyWouldSend?: boolean;
};

const parityCases: ParityCase[] = [
  {
    name: "lastIdxFromEvent=null — infer from flow_step (hasWarmupQ1, flow_step=3 → extra 1)",
    input: {
      contactFlowStep: 3,
      lastIdxFromEvent: null,
      lastAssistModel: "sales_flow_warmup_extra",
      hasWarmupQ1: true,
      cleanStepsCount: 5,
    },
    legacyExtraIdx: 1,
  },
  {
    name: "lastIdxFromEvent=null — infer via unbumpedIdx (hasWarmupQ1, flow_step=1 → extra 0)",
    input: {
      contactFlowStep: 1,
      lastIdxFromEvent: null,
      lastAssistModel: null,
      hasWarmupQ1: true,
      cleanStepsCount: 5,
    },
    legacyExtraIdx: 0,
  },
  {
    name: "lastIdxFromEvent=null — no Q1, flow_step=2 → extra 1",
    input: {
      contactFlowStep: 2,
      lastIdxFromEvent: null,
      lastAssistModel: "flow_continuation_warmup_extra",
      hasWarmupQ1: false,
      cleanStepsCount: 5,
    },
    legacyExtraIdx: 1,
  },
  {
    name: "lastIdxFromEvent=null — single extra step falls back to idx 0",
    input: {
      contactFlowStep: 0,
      lastIdxFromEvent: null,
      lastAssistModel: "sales_flow_warmup_extra",
      hasWarmupQ1: true,
      cleanStepsCount: 1,
    },
    legacyExtraIdx: 0,
  },
  {
    name: "lastIdxFromEvent=null — past all extras, no resend target",
    input: {
      contactFlowStep: 8,
      lastIdxFromEvent: null,
      lastAssistModel: "sales_flow_warmup_extra",
      hasWarmupQ1: true,
      cleanStepsCount: 5,
    },
    legacyExtraIdx: null,
  },
  {
    name: "last step awaiting answer (lastIdxFromEvent=4 of 5)",
    input: {
      contactFlowStep: 5,
      lastIdxFromEvent: 4,
      lastAssistModel: "sales_flow_warmup_extra",
      hasWarmupQ1: true,
      cleanStepsCount: 5,
    },
    legacyExtraIdx: 4,
    stepFixture: { question: "שאלה 5/5", options: ["א", "ב"] },
    legacyWouldSend: true,
  },
  {
    name: "resolved idx with only one option — idx set but route would not send",
    input: {
      contactFlowStep: 2,
      lastIdxFromEvent: 1,
      lastAssistModel: "sales_flow_warmup_extra",
      hasWarmupQ1: true,
      cleanStepsCount: 5,
    },
    legacyExtraIdx: 1,
    stepFixture: { question: "שאלה 2/5", options: ["יחיד"] },
    legacyWouldSend: false,
  },
  {
    name: "lastIdxFromEvent out of range — legacy keeps raw event idx (route blocks send)",
    input: {
      contactFlowStep: 3,
      lastIdxFromEvent: 7,
      lastAssistModel: "sales_flow_warmup_extra",
      hasWarmupQ1: true,
      cleanStepsCount: 5,
    },
    legacyExtraIdx: 7,
    stepFixture: undefined,
    legacyWouldSend: false,
  },
  {
    name: "explicit event idx wins over flow_step (stale race baseline)",
    input: {
      contactFlowStep: 3,
      lastIdxFromEvent: 2,
      lastAssistModel: "sales_flow_warmup_extra",
      hasWarmupQ1: true,
      cleanStepsCount: 5,
    },
    legacyExtraIdx: 2,
  },
];

for (const c of parityCases) {
  const legacyComputed = legacyResendWarmupExtraIdx(c.input);
  assert.equal(
    legacyComputed,
    c.legacyExtraIdx,
    `${c.name}: legacy helper drift — got ${legacyComputed}, expected ${c.legacyExtraIdx}`
  );

  const resolved = resolveWarmupResendExtraIdx(c.input);
  assert.equal(
    resolved,
    c.legacyExtraIdx,
    `${c.name}: resolveWarmupResendExtraIdx — got ${resolved}, legacy ${c.legacyExtraIdx}`
  );

  const decision = decideWarmupExtraResendAction(c.input);
  if (c.legacyExtraIdx == null) {
    assert.equal(decision.action, "skip", `${c.name}: expected skip`);
    assert.equal(decision.reason, "no_resend_target", c.name);
  } else {
    assert.equal(decision.action, "send", `${c.name}: expected send decision`);
    assert.equal(decision.targetExtraIdx, c.legacyExtraIdx, c.name);
  }

  if (c.stepFixture !== undefined || c.legacyWouldSend !== undefined) {
    const step =
      c.legacyExtraIdx != null && c.stepFixture
        ? c.stepFixture
        : c.legacyExtraIdx != null
          ? undefined
          : undefined;
    const wouldSend = legacyWouldSendWarmupExtraResend(c.legacyExtraIdx, step);
    assert.equal(
      wouldSend,
      c.legacyWouldSend ?? false,
      `${c.name}: legacyWouldSendWarmupExtraResend`
    );
  }
}

console.log(`wa-warmup-resend-parity: ${parityCases.length} cases passed`);
