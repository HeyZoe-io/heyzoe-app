"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DUAL_BRANCHES,
  emptyBranchOffers,
  type BranchOffers,
  type BranchScheduleSlot,
  type DualBranchId,
} from "@/lib/dual-branch";
import { HEBREW_DAY_OPTIONS, createEmptyProductScheduleSlot } from "@/lib/product-schedule-slots";
import { dashboardDir, type DashboardLang } from "@/lib/dashboard-lang";
import type { DashboardSettingsT } from "@/lib/dashboard-settings-i18n";
import { SALES_PATH_INPUT, SalesPathFieldLabel } from "./sales-path-shell";

const SLOT_CONTROL =
  "h-8 rounded-lg border border-zinc-200/90 bg-white px-2 text-xs text-zinc-800 shadow-none outline-none transition-colors hover:border-zinc-300 focus:border-[#7133da]/35 focus:ring-1 focus:ring-[#7133da]/25";

const DAY_SORT: Record<string, number> = { א: 0, ב: 1, ג: 2, ד: 3, ה: 4, ו: 5, ש: 6 };

function sortSlots(slots: BranchScheduleSlot[]): BranchScheduleSlot[] {
  const toMin = (t: string): number => {
    const m = String(t ?? "").trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    if (!m) return 10_000;
    return Number(m[1]) * 60 + Number(m[2]);
  };
  return [...slots].sort((a, b) => {
    const da = DAY_SORT[a.day] ?? 99;
    const db = DAY_SORT[b.day] ?? 99;
    if (da !== db) return da - db;
    return toMin(a.time) - toMin(b.time);
  });
}

function branchTitle(id: DualBranchId, t: DashboardSettingsT): string {
  return id === "amiad" ? t.products.branchAmiad : t.products.branchKiryatShmona;
}

export function DualBranchProductFields(props: {
  lang: DashboardLang;
  t: DashboardSettingsT;
  showSlots: boolean;
  offers: BranchOffers | undefined;
  onChange: (next: BranchOffers) => void;
  newId: () => string;
}) {
  const { lang, t, showSlots, onChange, newId } = props;
  const offers = props.offers ?? emptyBranchOffers();

  function patch(id: DualBranchId, partial: Partial<BranchOffers[DualBranchId]>) {
    onChange({ ...offers, [id]: { ...offers[id], ...partial } });
  }

  return (
    <div className="space-y-3" dir={dashboardDir(lang)}>
      <p className="text-[11px] leading-snug text-zinc-500">{t.products.branchSplitHint}</p>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {DUAL_BRANCHES.map((branch) => {
          const offer = offers[branch.id];
          return (
            <section
              key={branch.id}
              className="space-y-3 rounded-xl border border-[#7133da]/15 bg-[#f9f6ff]/50 p-3"
            >
              <h4 className="text-sm font-semibold text-[#2d1a6e]">{branchTitle(branch.id, t)}</h4>
              <div>
                <SalesPathFieldLabel>{t.products.paymentPage}</SalesPathFieldLabel>
                <Input
                  dir="ltr"
                  value={offer.paymentPage}
                  onChange={(e) => patch(branch.id, { paymentPage: e.target.value })}
                  placeholder="https://..."
                  className={`${SALES_PATH_INPUT} text-left font-mono text-sm`}
                />
              </div>
              <div>
                <SalesPathFieldLabel>{t.products.paymentLink}</SalesPathFieldLabel>
                <Input
                  dir="ltr"
                  value={offer.paymentLink}
                  onChange={(e) => patch(branch.id, { paymentLink: e.target.value })}
                  placeholder="https://..."
                  className={`${SALES_PATH_INPUT} text-left font-mono text-sm`}
                />
              </div>
              {showSlots ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-medium text-zinc-800">{t.products.weeklySlots}</span>
                    {(offer.scheduleSlots ?? []).length > 0 ? (
                      <button
                        type="button"
                        className="rounded p-0.5 text-zinc-400 hover:bg-red-50 hover:text-red-500"
                        aria-label={t.products.clearWeeklySlots}
                        onClick={() => patch(branch.id, { scheduleSlots: [] })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                  <p className="text-[11px] leading-snug text-zinc-500">
                    {(offer.scheduleSlots ?? []).length > 0
                      ? t.products.weeklySlotsHint
                      : t.products.weeklySlotsOffHint}
                  </p>
                  <div
                    className="space-y-2"
                    onBlurCapture={(e) => {
                      const next = e.relatedTarget as Node | null;
                      if (next && e.currentTarget.contains(next)) return;
                      patch(branch.id, { scheduleSlots: sortSlots(offer.scheduleSlots ?? []) });
                    }}
                  >
                    {(offer.scheduleSlots ?? []).map((slot, si) => (
                      <div
                        key={slot.id}
                        className="flex items-center gap-2 rounded-lg border border-zinc-200/70 bg-white/90 p-2"
                      >
                        <select
                          dir={dashboardDir(lang)}
                          className={`${SLOT_CONTROL} min-w-0 flex-1`}
                          value={HEBREW_DAY_OPTIONS.some((o) => o.value === slot.day) ? slot.day : ""}
                          onChange={(e) => {
                            const slots = [...(offer.scheduleSlots ?? [])];
                            slots[si] = { ...slot, day: e.target.value };
                            patch(branch.id, { scheduleSlots: slots });
                          }}
                        >
                          <option value="">{t.choose}</option>
                          {HEBREW_DAY_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        <Input
                          dir="ltr"
                          className={`${SLOT_CONTROL} w-[4.5rem] font-mono text-left`}
                          placeholder="18:00"
                          inputMode="numeric"
                          maxLength={5}
                          value={slot.time}
                          onChange={(e) => {
                            const slots = [...(offer.scheduleSlots ?? [])];
                            slots[si] = { ...slot, time: e.target.value.replace(/[^\d:]/g, "").slice(0, 5) };
                            patch(branch.id, { scheduleSlots: slots });
                          }}
                        />
                        <button
                          type="button"
                          className="shrink-0 rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-500"
                          aria-label={t.products.deleteSlot}
                          onClick={() => {
                            const slots = (offer.scheduleSlots ?? []).filter((_, j) => j !== si);
                            patch(branch.id, { scheduleSlots: slots });
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 w-full gap-1 border-dashed bg-white/70 text-xs"
                    onClick={() =>
                      patch(branch.id, {
                        scheduleSlots: [...(offer.scheduleSlots ?? []), createEmptyProductScheduleSlot(newId)],
                      })
                    }
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {t.products.addSlot}
                  </Button>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
