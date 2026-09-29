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

function resolveIcountUser(): string {
  return process.env.ICOUNT_USER?.trim() ?? "";
}

function resolveIcountPass(): string {
  return process.env.ICOUNT_PASS?.trim() ?? "";
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

function resolveIcountLoginCredsOrError():
  | { ok: true; cid: string; user: string; pass: string }
  | { ok: false; error: string; detail?: string } {
  const cid = resolveIcountCompanyId();
  const user = resolveIcountUser();
  const pass = resolveIcountPass();
  if (!cid) return { ok: false, error: "missing_company_id", detail: "ICOUNT_COMPANY_ID" };
  if (!user) return { ok: false, error: "missing_user", detail: "ICOUNT_USER" };
  if (!pass) return { ok: false, error: "missing_pass", detail: "ICOUNT_PASS" };
  return { ok: true, cid, user, pass };
}

async function icountLogin(): Promise<{ ok: true; sid: string; cid: string } | { ok: false; error: string; detail?: string }> {
  const creds = resolveIcountLoginCredsOrError();
  if (!creds.ok) return creds;

  // iCount v3 login endpoint is auth/login (not user/login).
  const r = await postIcount("/auth/login", { cid: creds.cid, user: creds.user, pass: creds.pass });
  const j = r.json ?? {};
  const sid = String(j.sid ?? "").trim();

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

  if (!r.httpOk || hasErr || !hasOk || !sid) {
    return {
      ok: false,
      error: "login_failed",
      detail: r.rawText.slice(0, 600),
    };
  }

  return { ok: true, sid, cid: creds.cid };
}

function extractHksList(j: Record<string, unknown> | null): unknown[] {
  if (!j) return [];
  const list =
    j.hks_list ??
    j.hk_list ??
    (j.data && typeof j.data === "object" && !Array.isArray(j.data)
      ? (j.data as Record<string, unknown>).hks_list ?? (j.data as Record<string, unknown>).hk_list
      : null) ??
    j.results_list;
  if (Array.isArray(list)) return list;
  // iCount sometimes returns hks_list as an object keyed by hk_id.
  if (list && typeof list === "object") {
    try {
      return Object.values(list as Record<string, unknown>);
    } catch {
      return [];
    }
  }
  return [];
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
  const login = await icountLogin();
  if (!login.ok) return { error: login.error, detail: login.detail };

  const r = await postIcount("/hk/get_list", { sid: login.sid, cid: login.cid, client_id: clientId });
  const list = extractHksList(r.json);
  console.info("[icount-v3] hk/get_list", {
    httpStatus: r.httpStatus,
    count: list.length,
    httpOk: r.httpOk,
    body: r.json ?? r.rawText,
  });
  const statusFlag = r.json?.status;
  if (statusFlag === false || statusFlag === 0) {
    return { error: "hk_get_list_failed", detail: r.rawText.slice(0, 600) };
  }
  if (!r.httpOk && list.length === 0) {
    return { error: "hk_get_list_failed", detail: r.rawText.slice(0, 400) };
  }
  return { hksList: list, raw: r };
}

export async function icountHkCancel(
  hkId: string,
  clientId: string
): Promise<{ ok: boolean; raw: IcountPostResult }> {
  const login = await icountLogin();
  if (!login.ok) {
    return {
      ok: false,
      raw: { httpOk: false, httpStatus: 500, json: { error: login.error, detail: login.detail }, rawText: login.detail ?? login.error },
    };
  }
  const r = await postIcount("/hk/cancel", {
    sid: login.sid,
    cid: login.cid,
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

  const creds = resolveIcountLoginCredsOrError();
  if (!creds.ok) {
    console.warn("[icount-v3] standing-order:missing_auth", creds);
    return { kind: "skipped_no_credentials", detail: creds.detail ?? creds.error };
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

export type IcountInvrecRow = {
  clientId: string;
  /** מה ששולם בפועל, כולל מע״מ (`total` / `totalwithvat`). */
  totalIls: number;
  cancelled: boolean;
};

function isCancelledFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  const s = String(value ?? "").trim().toLowerCase();
  return s === "1" || s === "true";
}

export function parseIcountInvrecRows(list: unknown): IcountInvrecRow[] {
  const rows = Array.isArray(list)
    ? list
    : list && typeof list === "object"
      ? Object.values(list as Record<string, unknown>)
      : [];
  const out: IcountInvrecRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const clientId = String(o.client_id ?? "").trim();
    const totalIls = Number(o.total ?? o.totalwithvat ?? o.totalpaid);
    if (!clientId || !Number.isFinite(totalIls)) continue;
    out.push({
      clientId,
      totalIls,
      cancelled: isCancelledFlag(o.is_cancelled) || isCancelledFlag(o.is_cancellation),
    });
  }
  return out;
}

function roundAgorot(n: number): number {
  return Math.round(n * 100) / 100;
}

/** סכום ששולם בטווח, בלי מסמכים מבוטלים. */
export function sumCollectedByClient(rows: IcountInvrecRow[]): Map<string, number> {
  const sums = new Map<string, number>();
  for (const row of rows) {
    if (row.cancelled) continue;
    sums.set(row.clientId, roundAgorot((sums.get(row.clientId) ?? 0) + row.totalIls));
  }
  return sums;
}

function compactYmd(raw: string): string {
  return String(raw ?? "").replace(/-/g, "").slice(0, 8);
}

function addCompactDays(ymd: string, days: number): string {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6));
  const d = Number(ymd.slice(6, 8));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

const INVREC_PAGE = 100;
const INVREC_MAX_PAGES = 8;

async function searchInvrecPage(
  login: { sid: string; cid: string },
  startYmd: string,
  endYmd: string,
  offset: number
): Promise<IcountPostResult> {
  return postIcount("/doc/search", {
    sid: login.sid,
    cid: login.cid,
    doctype: "invrec",
    start_date: startYmd,
    end_date: endYmd,
    detail_level: 1,
    max_results: INVREC_PAGE,
    offset,
  });
}

/**
 * חשבוניות מס-קבלה בטווח. קריאה אחת (או כמה עמודים) לכל הדשבורד, לא לפי לקוח.
 * מסמכים של לקוחות שאינם HeyZoe נשארים בתוצאה — הסינון הוא לפי icount_client_id אצלנו.
 */
export async function fetchIcountInvrecTotals(input: {
  startDate: string;
  endDate: string;
}): Promise<{ ok: true; rows: IcountInvrecRow[]; truncated: boolean } | { ok: false; error: string }> {
  const startYmd = compactYmd(input.startDate);
  const endYmd = compactYmd(input.endDate);
  if (!/^\d{8}$/.test(startYmd) || !/^\d{8}$/.test(endYmd)) {
    return { ok: false, error: "bad_date_range" };
  }

  const login = await icountLogin();
  if (!login.ok) {
    console.error("[icount-v3] invrec login failed:", login.error);
    return { ok: false, error: login.error };
  }

  try {
    return await collectInvrecRange(login, startYmd, endYmd, 0);
  } catch (e) {
    console.error("[icount-v3] invrec search failed:", e);
    return { ok: false, error: "request_failed" };
  }
}

async function collectInvrecRange(
  login: { sid: string; cid: string },
  startYmd: string,
  endYmd: string,
  depth: number
): Promise<{ ok: true; rows: IcountInvrecRow[]; truncated: boolean } | { ok: false; error: string }> {
  const rows: IcountInvrecRow[] = [];
  for (let page = 0; page < INVREC_MAX_PAGES; page++) {
    const result = await searchInvrecPage(login, startYmd, endYmd, page * INVREC_PAGE);
    const reason = String(result.json?.reason ?? "").toLowerCase();
    const tooMany = reason.includes("too_many") || String(result.json?.error_description ?? "").includes("יותר מדי");
    if (tooMany && startYmd < endYmd && depth < 6) {
      const mid = addCompactDays(startYmd, Math.max(1, Math.floor((Date.parse(`${endYmd.slice(0, 4)}-${endYmd.slice(4, 6)}-${endYmd.slice(6, 8)}T00:00:00Z`) - Date.parse(`${startYmd.slice(0, 4)}-${startYmd.slice(4, 6)}-${startYmd.slice(6, 8)}T00:00:00Z`)) / 86400000 / 2)));
      const leftEnd = mid > startYmd ? addCompactDays(mid, -1) : startYmd;
      const rightStart = leftEnd < endYmd ? addCompactDays(leftEnd, 1) : endYmd;
      const [left, right] = await Promise.all([
        collectInvrecRange(login, startYmd, leftEnd, depth + 1),
        collectInvrecRange(login, rightStart, endYmd, depth + 1),
      ]);
      if (!left.ok) return left;
      if (!right.ok) return right;
      return { ok: true, rows: [...left.rows, ...right.rows], truncated: left.truncated || right.truncated };
    }
    const statusFlag = result.json?.status;
    if (statusFlag === false || statusFlag === 0) {
      console.error("[icount-v3] invrec search failed:", reason || result.rawText.slice(0, 300));
      return { ok: false, error: reason || "search_failed" };
    }
    const batch = parseIcountInvrecRows(result.json?.results_list);
    rows.push(...batch);
    if (batch.length < INVREC_PAGE) return { ok: true, rows, truncated: false };
  }
  console.error("[icount-v3] invrec search truncated at", INVREC_MAX_PAGES * INVREC_PAGE);
  return { ok: true, rows, truncated: true };
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
