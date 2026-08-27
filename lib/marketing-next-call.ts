/** תאריך שיחה הבאה בפייפליין פולואפ אנושי — YYYY-MM-DD */
export function toPipelineDateOnly(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** שעת שיחה — HH:mm (מ־Postgres time / input type=time) */
export function toPipelineTime(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const match = raw.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  if (!match) return null;
  return `${match[1]}:${match[2]}`;
}

export function israelNowHm(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hour = (parts.find((p) => p.type === "hour")?.value ?? "00").padStart(2, "0");
  const minute = (parts.find((p) => p.type === "minute")?.value ?? "00").padStart(2, "0");
  return `${hour}:${minute}`;
}

export function nextCallSortMs(
  dateRaw: string | null | undefined,
  timeRaw: string | null | undefined
): number {
  const date = toPipelineDateOnly(dateRaw);
  if (!date) return Number.POSITIVE_INFINITY;
  const time = toPipelineTime(timeRaw) ?? "00:00";
  const t = new Date(`${date}T${time}:00`).getTime();
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

export function isHumanCallOverdue(
  dateRaw: string | null | undefined,
  timeRaw: string | null | undefined,
  todayYmd: string,
  nowHm: string
): boolean {
  const date = toPipelineDateOnly(dateRaw);
  if (!date) return false;
  if (date < todayYmd) return true;
  if (date > todayYmd) return false;
  const time = toPipelineTime(timeRaw);
  if (!time) return false;
  return time < nowHm;
}

export function formatNextCallLabel(
  dateRaw: string | null | undefined,
  timeRaw: string | null | undefined
): string {
  const date = toPipelineDateOnly(dateRaw);
  if (!date) return "";
  const [, month, day] = date.split("-");
  const dateHe = `${day}.${month}.${date.slice(0, 4)}`;
  const time = toPipelineTime(timeRaw);
  return time ? `${dateHe} · ${time}` : dateHe;
}
