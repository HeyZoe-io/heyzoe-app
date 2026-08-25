import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { estimateCostUsd } from "@/lib/ai-pricing";
import {
  formatIsraelYearMonth,
  getIsraelDayStartUtc,
  getIsraelMonthStartUtc,
} from "@/lib/israel-time";

export type AiUsageGranularity = "month" | "total";

/** One row as produced by the grouped SELECT contract (see fetchAiUsageGroupedRows). */
export type AiUsageGroupedRow = {
  business_id: number;
  /** Israel calendar month start as YYYY-MM-DD, or null when granularity=total */
  month: string | null;
  model: string;
  call_type: string;
  input_tokens: number;
  output_tokens: number;
};

export type AiUsageTokenCostBreakdown = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
};

export type AiUsageMonthBucket = {
  month: string; // "2026-08"
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  byCallType: Record<string, AiUsageTokenCostBreakdown>;
  byModel: Record<string, AiUsageTokenCostBreakdown>;
};

export type AiUsageBusinessReport = {
  businessId: number;
  slug: string;
  name: string;
  months: AiUsageMonthBucket[];
  peakMonth: { month: string; totalCostUsd: number; totalTokens?: number } | null;
  rangeTotalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Populated when granularity=total (months will be []). */
  totalCostUsd?: number;
  byCallType?: Record<string, AiUsageTokenCostBreakdown>;
  byModel?: Record<string, AiUsageTokenCostBreakdown>;
};

type RawUsageRow = {
  business_id: number;
  created_at: string;
  model: string;
  call_type: string;
  input_tokens: number;
  output_tokens: number;
};

function addCalendarMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

/** Trailing 12 Israel calendar months (inclusive of current month start). */
export function defaultAiUsageWindowFromIso(now: Date = new Date()): string {
  const thisMonthStart = getIsraelMonthStartUtc(now);
  const ym = formatIsraelYearMonth(thisMonthStart);
  const [yStr, mStr] = ym.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const start = addCalendarMonths(y, m, -11);
  return getIsraelDayStartUtc(start.year, start.month, 1).toISOString();
}

function monthKeyFromCreatedAt(createdAtIso: string): string {
  return formatIsraelYearMonth(new Date(createdAtIso));
}

function monthDateFromKey(monthKey: string): string {
  // YYYY-MM → YYYY-MM-01 (matches date_trunc(...)::date string form)
  return `${monthKey}-01`;
}

function accumulateBreakdown(
  map: Record<string, AiUsageTokenCostBreakdown>,
  key: string,
  inputTokens: number,
  outputTokens: number,
  costUsd: number
): void {
  const prev = map[key] ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 };
  const nextIn = prev.inputTokens + inputTokens;
  const nextOut = prev.outputTokens + outputTokens;
  map[key] = {
    inputTokens: nextIn,
    outputTokens: nextOut,
    totalTokens: nextIn + nextOut,
    costUsd: prev.costUsd + costUsd,
  };
}

/**
 * Single source-read for ai_usage aggregates.
 *
 * Contract (SQL equivalent — swap to an RPC later without changing callers):
 *   SELECT business_id,
 *          date_trunc('month', created_at AT TIME ZONE 'Asia/Jerusalem')::date AS month,
 *          model, call_type,
 *          sum(input_tokens)  AS input_tokens,
 *          sum(output_tokens) AS output_tokens
 *   FROM ai_usage
 *   WHERE (:business_id IS NULL OR business_id = :business_id)
 *     AND (:from IS NULL OR created_at >= :from)
 *     AND (:to   IS NULL OR created_at <  :to)
 *   GROUP BY business_id, month, model, call_type;
 *
 * With granularity=total, month is null and GROUP BY drops month.
 *
 * Implementation today: filtered select (indexed) + JS group matching Asia/Jerusalem
 * month buckets (no migration / no RPC yet). Cost is never computed here.
 *
 * Supabase/PostgREST silently caps each select at 1000 rows (project db-max-rows
 * default). We page with .range() until a short page — do NOT remove that loop.
 * TODO(volume): swap this function body to a SQL GROUP BY RPC (contract above)
 * once pulling raw rows into memory becomes too heavy; callers stay unchanged.
 */
export async function fetchAiUsageGroupedRows(input: {
  businessId?: number | null;
  fromIso?: string | null;
  toIso?: string | null;
  granularity?: AiUsageGranularity;
}): Promise<AiUsageGroupedRow[]> {
  const admin = createSupabaseAdminClient();
  const granularity: AiUsageGranularity = input.granularity === "total" ? "total" : "month";
  // Match PostgREST default max-rows (1000); larger pages can still be truncated.
  const pageSize = 1000;
  const raw: RawUsageRow[] = [];

  for (let offset = 0; ; offset += pageSize) {
    let q = admin
      .from("ai_usage")
      .select("business_id, created_at, model, call_type, input_tokens, output_tokens")
      .order("created_at", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (input.businessId != null && Number.isFinite(input.businessId) && input.businessId > 0) {
      q = q.eq("business_id", input.businessId);
    }
    if (input.fromIso) q = q.gte("created_at", input.fromIso);
    if (input.toIso) q = q.lt("created_at", input.toIso);

    const { data, error } = await q;
    if (error) {
      console.error("[ai-usage-aggregate] fetch failed:", error.message);
      throw new Error(error.message);
    }
    const batch = (data ?? []) as RawUsageRow[];
    raw.push(...batch);
    if (batch.length < pageSize) break;
  }

  const grouped = new Map<string, AiUsageGroupedRow>();
  for (const row of raw) {
    const businessId = Number(row.business_id);
    if (!Number.isFinite(businessId) || businessId <= 0) continue;
    const model = String(row.model ?? "").trim() || "unknown";
    const callType = String(row.call_type ?? "").trim() || "other";
    const monthKey = granularity === "month" ? monthKeyFromCreatedAt(String(row.created_at)) : null;
    const month = monthKey ? monthDateFromKey(monthKey) : null;
    const mapKey = `${businessId}|${month ?? ""}|${model}|${callType}`;
    const prev = grouped.get(mapKey);
    const inn = Number(row.input_tokens) || 0;
    const out = Number(row.output_tokens) || 0;
    if (prev) {
      prev.input_tokens += inn;
      prev.output_tokens += out;
    } else {
      grouped.set(mapKey, {
        business_id: businessId,
        month,
        model,
        call_type: callType,
        input_tokens: inn,
        output_tokens: out,
      });
    }
  }

  return [...grouped.values()];
}

/** Cost + rollup in JS from grouped token rows. */
export async function buildAiUsageBusinessReports(input: {
  businessId?: number | null;
  fromIso?: string | null;
  toIso?: string | null;
  granularity?: AiUsageGranularity;
}): Promise<AiUsageBusinessReport[]> {
  const granularity: AiUsageGranularity = input.granularity === "total" ? "total" : "month";
  const rows = await fetchAiUsageGroupedRows(input);
  if (!rows.length) return [];

  const admin = createSupabaseAdminClient();
  const businessIds = [...new Set(rows.map((r) => r.business_id))];
  const { data: bizRows, error: bizErr } = await admin
    .from("businesses")
    .select("id, slug, name")
    .in("id", businessIds);
  if (bizErr) {
    console.error("[ai-usage-aggregate] businesses lookup failed:", bizErr.message);
    throw new Error(bizErr.message);
  }
  const metaById = new Map<number, { slug: string; name: string }>();
  for (const b of bizRows ?? []) {
    const id = Number((b as { id: number }).id);
    metaById.set(id, {
      slug: String((b as { slug?: string }).slug ?? ""),
      name: String((b as { name?: string | null }).name ?? "").trim(),
    });
  }

  type Acc = {
    months: Map<string, AiUsageMonthBucket>;
    byCallType: Record<string, AiUsageTokenCostBreakdown>;
    byModel: Record<string, AiUsageTokenCostBreakdown>;
    rangeTotalCostUsd: number;
    inputTokens: number;
    outputTokens: number;
  };
  const byBusiness = new Map<number, Acc>();

  for (const row of rows) {
    const cost = estimateCostUsd(row.model, row.input_tokens, row.output_tokens);
    let acc = byBusiness.get(row.business_id);
    if (!acc) {
      acc = {
        months: new Map(),
        byCallType: {},
        byModel: {},
        rangeTotalCostUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
      byBusiness.set(row.business_id, acc);
    }
    acc.rangeTotalCostUsd += cost;
    acc.inputTokens += row.input_tokens;
    acc.outputTokens += row.output_tokens;
    accumulateBreakdown(acc.byCallType, row.call_type, row.input_tokens, row.output_tokens, cost);
    accumulateBreakdown(acc.byModel, row.model, row.input_tokens, row.output_tokens, cost);

    if (granularity === "month" && row.month) {
      const monthKey = row.month.slice(0, 7); // YYYY-MM-DD → YYYY-MM
      let bucket = acc.months.get(monthKey);
      if (!bucket) {
        bucket = {
          month: monthKey,
          totalCostUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          byCallType: {},
          byModel: {},
        };
        acc.months.set(monthKey, bucket);
      }
      bucket.totalCostUsd += cost;
      bucket.inputTokens += row.input_tokens;
      bucket.outputTokens += row.output_tokens;
      bucket.totalTokens = bucket.inputTokens + bucket.outputTokens;
      accumulateBreakdown(bucket.byCallType, row.call_type, row.input_tokens, row.output_tokens, cost);
      accumulateBreakdown(bucket.byModel, row.model, row.input_tokens, row.output_tokens, cost);
    }
  }

  const reports: AiUsageBusinessReport[] = [];
  for (const businessId of [...byBusiness.keys()].sort((a, b) => a - b)) {
    const acc = byBusiness.get(businessId)!;
    const months = [...acc.months.values()].sort((a, b) => a.month.localeCompare(b.month));
    let peakMonth: AiUsageBusinessReport["peakMonth"] = null;
    for (const m of months) {
      if (!peakMonth || m.totalCostUsd > peakMonth.totalCostUsd) {
        peakMonth = {
          month: m.month,
          totalCostUsd: m.totalCostUsd,
          totalTokens: m.totalTokens,
        };
      }
    }

    const totalTokens = acc.inputTokens + acc.outputTokens;
    const meta = metaById.get(businessId);
    const report: AiUsageBusinessReport = {
      businessId,
      slug: meta?.slug ?? "",
      name: meta?.name ?? "",
      months: granularity === "month" ? months : [],
      peakMonth: granularity === "month" ? peakMonth : null,
      rangeTotalCostUsd: acc.rangeTotalCostUsd,
      inputTokens: acc.inputTokens,
      outputTokens: acc.outputTokens,
      totalTokens,
    };
    if (granularity === "total") {
      report.totalCostUsd = acc.rangeTotalCostUsd;
      report.byCallType = acc.byCallType;
      report.byModel = acc.byModel;
    }
    reports.push(report);
  }

  return reports;
}
