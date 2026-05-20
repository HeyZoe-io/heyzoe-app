export type MarketingFlowNode = {
  id: string;
  type: string;
  data: Record<string, unknown>;
};

export type MarketingFlowEdge = {
  id: string;
  source_node_id: string;
  target_node_id: string;
  label: string;
};

export type MarketingFlowSnapshot = {
  nodes: MarketingFlowNode[];
  edges: MarketingFlowEdge[];
  isActive: boolean;
};

const g = globalThis as unknown as { __hzMarketingFlowCache?: MarketingFlowSnapshot | null };

function cacheRef(): MarketingFlowSnapshot | null {
  return g.__hzMarketingFlowCache ?? null;
}

export function getMarketingFlowCache(): MarketingFlowSnapshot | null {
  return cacheRef();
}

export function setMarketingFlowCache(snapshot: MarketingFlowSnapshot): void {
  g.__hzMarketingFlowCache = snapshot;
}

/** נקרא אחרי שמירת פלואו בדשבורד — ה-instance הבא טוען מחדש מ-DB */
export function invalidateMarketingFlowCache(): void {
  g.__hzMarketingFlowCache = null;
}
