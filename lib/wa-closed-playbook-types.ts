/** Intent categories Zoe has no authority to execute — skip Claude, fixed copy. */
export type ClosedPlaybookCategory =
  | "reschedule"
  | "cancellation"
  | "freeze"
  | "refund"
  | "medical"
  | "complaint"
  | "group"
  | "discount"
  | "coach_owner";

/**
 * policy = asking how the studio handles this topic.
 * action = asking Zoe / the studio to do it on their account (or a complaint / group request / coach contact).
 */
export type ClosedPlaybookShape = "action" | "policy";

export type ClosedPlaybookIntent = {
  category: ClosedPlaybookCategory;
  shape: ClosedPlaybookShape;
};

export type ClosedPlaybookCatalogService = {
  name?: string | null;
  descriptionText?: string | null;
  benefit?: string | null;
  offerKind?: string | null;
};

export type ClosedPlaybookKnowledge = {
  botName?: string | null;
  traits?: string[] | null;
  knowledgeQa?: Array<{ question?: string | null; answer?: string | null }> | null;
  faqsText?: string | null;
  promotionsText?: string | null;
  membershipsAndCardsText?: string | null;
  /** Existing sales-flow catalog — lookup only, no schema change. */
  salesFlowServices?: ClosedPlaybookCatalogService[] | null;
};

export type ClosedPlaybookResolution = {
  category: ClosedPlaybookCategory;
  shape: ClosedPlaybookShape;
  reply: string;
  modelUsed: string;
  notifyHumanRequested: boolean;
  source: "default" | "fact" | "promo" | "catalog";
  /** Unique catalog product — webhook re-sends product pick (does not auto-CTA). */
  catalogServiceName?: string;
};
