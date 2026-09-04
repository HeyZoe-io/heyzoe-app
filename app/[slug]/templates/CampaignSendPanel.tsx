"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  estimateManualBulkSendDurationMinutes,
  MANUAL_BULK_WEEKS_DEFAULT,
  type ManualBulkAudienceType,
} from "@/lib/manual-bulk/constants";
import {
  estimateManualBulkFinishAt,
  formatIsraelWallDateTimeHe,
  israelDatetimeLocalString,
  resolveManualBulkSchedule,
} from "@/lib/manual-bulk/schedule";

export type CampaignSendTemplateOption = {
  name: string;
  category?: string;
  status?: string;
  disabled?: boolean;
  language?: string;
};

type MembershipTypeRow = { membership_type_id: number; membership_type_name: string };

type PreviewResult = {
  with_phone_count: number;
  without_phone_count: number;
  skipped: Record<string, number>;
  eta_minutes: number;
  drain_batch: number;
  drain_interval_minutes: number;
  template_preview: string;
  template_name: string;
  hit_message_page_cap?: boolean;
};

const FIELD =
  "w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 text-right";

function formatEta(minutes: number): string {
  if (minutes <= 0) return "מיידי (אין נמענים)";
  if (minutes < 60) return `כ-${minutes} דקות`;
  const hours = minutes / 60;
  if (hours === Math.trunc(hours)) return `כ-${hours} שעות`;
  return `כ-${hours.toFixed(1)} שעות`;
}

/** M1 preview→confirm→schedule panel embedded in the templates manual branch. */
export default function CampaignSendPanel(props: {
  slug: string;
  audienceType: ManualBulkAudienceType;
  templates: CampaignSendTemplateOption[];
  onClose?: () => void;
}) {
  const audienceType = props.audienceType;
  const [weeks, setWeeks] = useState(MANUAL_BULK_WEEKS_DEFAULT);
  const [templateName, setTemplateName] = useState(props.templates[0]?.name ?? "");
  const [membershipTypes, setMembershipTypes] = useState<MembershipTypeRow[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [includePunchCards, setIncludePunchCards] = useState(false);
  const [whenMode, setWhenMode] = useState<"now" | "later">("now");
  const [scheduledLocal, setScheduledLocal] = useState(() =>
    israelDatetimeLocalString(new Date(Date.now() + 60 * 60 * 1000))
  );
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState<"preview" | "confirm" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queuedMsg, setQueuedMsg] = useState<string | null>(null);

  useEffect(() => {
    setPreview(null);
    setAck(false);
    setQueuedMsg(null);
    setError(null);
  }, [audienceType]);

  useEffect(() => {
    if (audienceType !== "membership") return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/dashboard/arbox-membership-types?slug=${encodeURIComponent(props.slug)}`
        );
        const j = (await res.json().catch(() => ({}))) as {
          types?: MembershipTypeRow[];
          error?: string;
        };
        if (cancelled || !res.ok) return;
        setMembershipTypes(Array.isArray(j.types) ? j.types : []);
      } catch {
        /* types stay empty — filter = all */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [audienceType, props.slug]);

  const scheduledAtRaw = whenMode === "later" ? scheduledLocal : undefined;

  const audiencePayload = useMemo(
    () => ({
      audience_type: audienceType,
      template_name: templateName,
      weeks,
      membership_type_names: selectedTypes,
      include_punch_cards: includePunchCards,
    }),
    [audienceType, templateName, weeks, selectedTypes, includePunchCards]
  );

  const payload = useMemo(
    () => ({
      ...audiencePayload,
      ...(scheduledAtRaw ? { scheduled_at: scheduledAtRaw } : {}),
    }),
    [audiencePayload, scheduledAtRaw]
  );

  const schedule = useMemo(
    () => resolveManualBulkSchedule({ scheduledAtRaw }),
    [scheduledAtRaw]
  );

  const scheduleHint = useMemo(() => {
    if (!preview) return null;
    if (!schedule.ok) {
      return {
        kind: "error" as const,
        text:
          schedule.error === "schedule_in_past"
            ? "לא ניתן לתזמן לזמן שעבר."
            : "תאריך או שעה לא תקינים.",
      };
    }
    const etaMinutes = estimateManualBulkSendDurationMinutes(preview.with_phone_count);
    const finishAt = estimateManualBulkFinishAt(preview.with_phone_count, schedule.dispatchAt);
    const startLabel = formatIsraelWallDateTimeHe(schedule.dispatchAt);
    const dueLabel = formatIsraelWallDateTimeHe(schedule.dueAt);
    const finishLabel = formatIsraelWallDateTimeHe(finishAt);
    if (schedule.windowAdjusted) {
      return {
        kind: "window" as const,
        text: schedule.scheduled
          ? `תוזמן ל-${dueLabel} — מחוץ לחלון השליחה (לילה / שבת). יתחיל בפועל ב-${startLabel}, סיום משוער ${finishLabel}.`
          : `עכשיו מחוץ לחלון השליחה. יתחיל בפועל ב-${startLabel}, סיום משוער ${finishLabel}.`,
        etaMinutes,
      };
    }
    return {
      kind: "ok" as const,
      text: schedule.scheduled
        ? `התחלה: ${startLabel} · סיום משוער: ${finishLabel}`
        : `התחלה: ב-drain הבא (${startLabel}) · סיום משוער: ${finishLabel}`,
      etaMinutes,
    };
  }, [preview, schedule]);

  async function runPreview() {
    setError(null);
    setQueuedMsg(null);
    setAck(false);
    setBusy("preview");
    try {
      const res = await fetch(`/api/${encodeURIComponent(props.slug)}/bulk-send/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(audiencePayload),
      });
      const j = (await res.json().catch(() => ({}))) as PreviewResult & { error?: string };
      if (!res.ok) {
        const mapped =
          j.error === "schedule_in_past"
            ? "לא ניתן לתזמן לזמן שעבר."
            : j.error === "invalid_schedule_time"
              ? "תאריך או שעה לא תקינים."
              : j.error || "preview_failed";
        throw new Error(mapped);
      }
      setPreview(j);
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : "preview_failed");
    } finally {
      setBusy(null);
    }
  }

  async function runConfirm() {
    if (!preview || !ack || !schedule.ok) return;
    setError(null);
    setBusy("confirm");
    try {
      const res = await fetch(`/api/${encodeURIComponent(props.slug)}/bulk-send/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, confirmed: true }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        queued?: number;
        eta_minutes?: number;
        dispatch_at_he?: string;
        eta_finish_at_he?: string;
        window_adjusted?: boolean;
      };
      if (!res.ok) {
        const mapped =
          j.error === "schedule_in_past"
            ? "לא ניתן לתזמן לזמן שעבר."
            : j.error === "invalid_schedule_time"
              ? "תאריך או שעה לא תקינים."
              : j.error || "confirm_failed";
        throw new Error(mapped);
      }
      const start = j.dispatch_at_he ? `התחלה ${j.dispatch_at_he}` : "ה-drain הבא";
      const finish = j.eta_finish_at_he ? ` · סיום משוער ${j.eta_finish_at_he}` : "";
      const held = j.window_adjusted ? " (נדחה לחלון השליחה)" : "";
      setQueuedMsg(
        `נכנס לתור: ${j.queued ?? 0} הודעות. ${start}${held}${finish}. מנות של 80 כל ${preview.drain_interval_minutes} דקות.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "confirm_failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4 text-right" dir="rtl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-zinc-900">שליחת קמפיין</p>
          <p className="mt-0.5 text-xs text-zinc-600">
            תבנית MARKETING מאושרת — תצוגה מקדימה, אישור, ותזמון לתור (בלי שליחה מיידית).
          </p>
        </div>
        {props.onClose ? (
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
          >
            סגור
          </button>
        ) : null}
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white p-3 space-y-3">
        {audienceType === "membership" ? (
          <div className="space-y-3">
            <label className="block text-sm text-zinc-700">
              סוגי מנוי (ריק = כולם)
              <select
                multiple
                className={`${FIELD} mt-1 h-32`}
                value={selectedTypes}
                onChange={(e) => {
                  setSelectedTypes(Array.from(e.target.selectedOptions).map((o) => o.value));
                  setPreview(null);
                }}
              >
                {membershipTypes.map((t) => (
                  <option key={t.membership_type_id} value={t.membership_type_name}>
                    {t.membership_type_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center justify-end gap-2 text-sm">
              <span>כולל כרטיסיות / sessions</span>
              <input
                type="checkbox"
                checked={includePunchCards}
                onChange={(e) => {
                  setIncludePunchCards(e.target.checked);
                  setPreview(null);
                }}
              />
            </label>
          </div>
        ) : (
          <label className="block text-sm text-zinc-700">
            שבועות אחרונים (הודעת לקוח נכנסת)
            <select
              className={`${FIELD} mt-1`}
              value={weeks}
              onChange={(e) => {
                setWeeks(Number(e.target.value));
                setPreview(null);
              }}
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block text-sm text-zinc-700">
          תבנית (מאושרת + MARKETING בלבד)
          <select
            className={`${FIELD} mt-1`}
            value={templateName}
            onChange={(e) => {
              setTemplateName(e.target.value);
              setPreview(null);
            }}
          >
            {props.templates.length === 0 ? (
              <option value="">אין תבנית MARKETING מאושרת</option>
            ) : (
              props.templates.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))
            )}
          </select>
        </label>

        <Button type="button" onClick={() => void runPreview()} disabled={!templateName || busy !== null}>
          {busy === "preview" ? "סופר…" : "הצג ספירה ותצוגה"}
        </Button>
      </section>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {queuedMsg ? <p className="text-sm text-emerald-700">{queuedMsg}</p> : null}

      {preview ? (
        <section className="rounded-xl border border-fuchsia-200 bg-fuchsia-50/40 p-3 space-y-3">
          <p className="text-sm text-zinc-800">
            <strong>{preview.with_phone_count}</strong> נמענים עם טלפון ·{" "}
            <strong>{preview.without_phone_count}</strong> בלי טלפון (לא יישלח)
          </p>
          <p className="text-sm text-zinc-700">
            משך שילוח משוער:{" "}
            {formatEta(
              scheduleHint && scheduleHint.kind !== "error" ? scheduleHint.etaMinutes : preview.eta_minutes
            )}{" "}
            (מנות של {preview.drain_batch}, drain כל {preview.drain_interval_minutes} דקות)
          </p>
          {preview.hit_message_page_cap ? (
            <p className="text-xs text-amber-700">חלון ההודעות גדול מהמגבלה — הספירה עלולה להיות חלקית.</p>
          ) : null}
          <pre className="whitespace-pre-wrap rounded-xl bg-white p-3 text-sm text-zinc-800 text-right border border-zinc-200">
            {preview.template_preview}
          </pre>
          <fieldset className="space-y-2 rounded-xl border border-zinc-200 bg-white p-3">
            <legend className="text-sm font-medium text-zinc-800">מתי לשלוח</legend>
            <label className="flex items-center justify-end gap-2 text-sm">
              <span>עכשיו (ב-drain הבא בתוך חלון השליחה)</span>
              <input
                type="radio"
                name="when"
                checked={whenMode === "now"}
                onChange={() => setWhenMode("now")}
              />
            </label>
            <label className="flex items-center justify-end gap-2 text-sm">
              <span>לתזמן לשעה מאוחרת יותר</span>
              <input
                type="radio"
                name="when"
                checked={whenMode === "later"}
                onChange={() => setWhenMode("later")}
              />
            </label>
            {whenMode === "later" ? (
              <label className="block text-sm text-zinc-700">
                תאריך ושעה (שעון ישראל)
                <input
                  type="datetime-local"
                  dir="ltr"
                  className={`${FIELD} mt-1 text-left`}
                  min={israelDatetimeLocalString()}
                  value={scheduledLocal}
                  onChange={(e) => setScheduledLocal(e.target.value)}
                />
              </label>
            ) : null}
            {scheduleHint ? (
              <p
                className={`text-sm ${scheduleHint.kind === "error" ? "text-red-600" : scheduleHint.kind === "window" ? "text-amber-800" : "text-zinc-700"}`}
              >
                {scheduleHint.text}
              </p>
            ) : null}
            <p className="text-xs text-zinc-500">
              לא שולחים בלילה (23:00–06:30) ולא משישי 16:00 עד שבת 19:00. תזמון לחלון חסום יידחה אוטומטית
              לפתיחה הבאה.
            </p>
          </fieldset>
          <label className="flex items-center justify-end gap-2 text-sm">
            <span>
              אני מאשר/ת לשלוח ל-{preview.with_phone_count} נמענים (כל אחד = שיחת MARKETING ב-WhatsApp)
            </span>
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          </label>
          <Button
            type="button"
            onClick={() => void runConfirm()}
            disabled={!ack || busy !== null || !schedule.ok}
          >
            {busy === "confirm" ? "מכניס לתור…" : "אשר והכנס לתור"}
          </Button>
        </section>
      ) : null}
    </div>
  );
}
