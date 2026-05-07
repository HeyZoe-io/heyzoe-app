/**
 * iCount API v3 — הוראות קבע (hk) עם Bearer Token.
 * בסיס: https://api.icount.co.il/api/v3.php
 */

const DEFAULT_BASE = "https://api.icount.co.il/api/v3.php";

export function resolveIcountV3Base(): string {
  return process.env.ICOUNT_API_BASE?.trim() || DEFAULT_BASE;
}

function url(path: string): string {
  const base = resolveIcountV3Base().replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

export type IcountPostResult = {
  httpOk: boolean;
  httpStatus: number;
  json: Record<string, unknown> | null;
  rawText: string;
};

function resolveIcountCompanyId(): string {
  return process.env.ICOUNT_COMPANY_ID?.trim() ?? "";
}

function resolveIcountApiToken(): string {
  return process.env.ICOUNT_API_TOKEN?.trim() ?? "";
}

async function postIcount(path: string, body: Record<string, unknown>): Promise<IcountPostResult> {
  const res = await fetch(url(path), {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const rawText = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(rawText);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) json = parsed as Record<string, unknown>;
  } catch {
    /* leave json null */
  }
  return { httpOk: res.ok, httpStatus: res.status, json, rawText };
}

function resolveIcountAuthOrError():
  | { ok: true; cid: string }
  | { ok: false; error: string; detail?: string } {
  const cid = resolveIcountCompanyId();
  const token = resolveIcountApiToken();
  if (!cid) return { ok: false, error: "missing_company_id", detail: "ICOUNT_COMPANY_ID" };
  if (!token) return { ok: false, error: "missing_api_token", detail: "ICOUNT_API_TOKEN" };
  return { ok: true, cid };
}

function extractHksList(j: Record<string, unknown> | null): unknown[] {
  if (!j) return [];
  const list =
    j.hks_list ??
    j.hk_list ??
    (j.data && typeof j.data === "object" && !Array.isArray(j.data)
      ? (j.data as any).hks_list ?? (j.data as any).hk_list
      : null) ??
    j.results_list;
  return Array.isArray(list) ? list : [];
}

function inactiveStatus(st: string): boolean {
  const s = st.toLowerCase();
  return ["cancel", "cancelled", "inactive", "deleted", "closed", "סגור", "בוטל"].some((x) => s.includes(x));
}

/** hk_id ראשון שנראה פעיל (לא מסומן כבוטל/סגור) */
export function pickFirstActiveHkId(hksList: unknown[]): string | null {
  for (const row of hksList) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const hkId = String(o.hk_id ?? o.hkId ?? o.hk_id_num ?? "").trim();
    if (!hkId) continue;
    const st = String(o.status ?? o.hk_status ?? o.state ?? "").trim();
    if (st && inactiveStatus(st)) continue;
    return hkId;
  }
  return null;
}

export async function icountHkGetList(
  clientId: string
): Promise<{ hksList: unknown[]; raw: IcountPostResult } | { error: string; detail?: string }> {
  const auth = resolveIcountAuthOrError();
  if (!auth.ok) return { error: auth.error, detail: auth.detail };
  const r = await postIcount("/hk/get_list", {
    sid: resolveIcountApiToken(),
    cid: auth.cid,
    client_id: clientId,
  });
  const list = extractHksList(r.json);
  console.info("[icount-v3] hk/get_list", {
    httpStatus: r.httpStatus,
    count: list.length,
    httpOk: r.httpOk,
  });
  if (!r.httpOk && list.length === 0) {
    return { error: "hk_get_list_failed", detail: r.rawText.slice(0, 400) };
  }
  return { hksList: list, raw: r };
}

export async function icountHkCancel(
  hkId: string,
  clientId: string
): Promise<{ ok: boolean; raw: IcountPostResult }> {
  const auth = resolveIcountAuthOrError();
  if (!auth.ok) {
    return {
      ok: false,
      raw: { httpOk: false, httpStatus: 500, json: { error: auth.error, detail: auth.detail }, rawText: auth.detail ?? auth.error },
    };
  }
  const r = await postIcount("/hk/cancel", {
    sid: resolveIcountApiToken(),
    cid: auth.cid,
    hk_id: hkId,
    client_id: clientId,
  });
  const j = r.json;
  const hasErr =
    Boolean(j) &&
    (j!.error === true ||
      j!.err === true ||
      (typeof j!.error === "string" && String(j!.error).trim().length > 0));
  const hasOk =
    Boolean(j) &&
    (j!.status === true ||
      j!.status === 1 ||
      j!.success === true ||
      j!.success === 1 ||
      String(j!.ok ?? "").toLowerCase() === "true");
  const ok = Boolean(r.httpOk && j && !hasErr && hasOk);
  console.info("[icount-v3] hk/cancel", {
    hk_id: hkId,
    httpStatus: r.httpStatus,
    ok,
    json: r.json ?? r.rawText.slice(0, 300),
  });
  return { ok: Boolean(ok), raw: r };
}

export type StandingOrderCancelOutcome =
  | { kind: "cancelled"; hk_id: string }
  | { kind: "no_hk_id"; reason: string }
  | { kind: "skipped_no_client_id" }
  | { kind: "skipped_no_credentials"; detail?: string }
  | { kind: "api_error"; step: string; detail?: string };

/**
 * ניסיון מלא: login → hk/get_list → hk/cancel לפי hk פעיל ראשון.
 * תמיד קורא ל-logout בסוף אם התחברנו.
 */
export async function tryCancelStandingOrder(clientIdRaw: string): Promise<StandingOrderCancelOutcome> {
  const clientId = String(clientIdRaw ?? "").trim();
  if (!clientId) {
    console.info("[icount-v3] standing-order:skip_no_client_id");
    return { kind: "skipped_no_client_id" };
  }

  const auth = resolveIcountAuthOrError();
  if (!auth.ok) {
    console.warn("[icount-v3] standing-order:missing_auth", auth);
    return { kind: "skipped_no_credentials", detail: auth.detail ?? auth.error };
  }

  const listed = await icountHkGetList(clientId);
  if ("error" in listed) {
    console.warn("[icount-v3] standing-order:list_failed", listed);
    return { kind: "api_error", step: "hk/get_list", detail: listed.detail ?? listed.error };
  }

  const hkId = pickFirstActiveHkId(listed.hksList);
  if (!hkId) {
    console.info("[icount-v3] standing-order:no_active_hk", { client_id: clientId, total: listed.hksList.length });
    return { kind: "no_hk_id", reason: "no_active_hk_in_list" };
  }

  const cancelled = await icountHkCancel(hkId, clientId);
  if (!cancelled.ok) {
    return {
      kind: "api_error",
      step: "hk/cancel",
      detail: cancelled.raw.rawText.slice(0, 400),
    };
  }
  return { kind: "cancelled", hk_id: hkId };
}

export function extractIcountClientIdFromPayload(payload: Record<string, unknown>): string | null {
  const keys = [
    "client_id",
    "Client_ID",
    "ClientId",
    "cust_id",
    "customer_id",
    "CustomerId",
    "icount_client_id",
    "clientID",
  ];
  for (const k of keys) {
    const v = payload[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}
