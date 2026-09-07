"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Check, Copy, Loader2, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import {
  DASHBOARD_CENTERED_CONTENT,
  DASHBOARD_SETTINGS_SHELL,
  dashboardStepTabClass,
} from "@/app/dashboard/[slug]/settings/settings-ui";
import { settingsStepHref } from "@/lib/dashboard-settings-i18n";
import {
  bodyTextFromTemplateComponents,
  extractBodyVarCount,
  isMetaTemplateContentEditable,
  isPresetAvailable,
  paramSlotsForTriggerType,
  parseDashboardTemplateComponents,
  presetExampleForSlot,
  presetVarHint,
  TEMPLATE_PRESETS,
  uniqueTemplateName,
} from "@/lib/template-presets";
import CampaignSendPanel from "@/app/[slug]/templates/CampaignSendPanel";
import {
  EMPTY_TEMPLATE_BUTTONS,
  EMPTY_TEMPLATE_DRAFT,
  TEMPLATE_NAME_RE,
  TemplateDraftFields,
  type TemplateButtonDraft,
  type TemplateDraftValue,
} from "@/app/[slug]/templates/TemplateDraftFields";
import { isApprovedMarketingTemplate } from "@/lib/manual-bulk/preview";
import {
  filterArboxMembershipTypesByWords,
  type ArboxMembershipTypeRow,
} from "@/lib/arbox-membership-types";
import {
  ACTIVATION_LABELS_HE,
  AUDIENCE_LABELS_HE,
  allowsDelayBefore,
  catalogEntriesFor,
  creatableCatalogEntriesForCell,
  defaultDelayDays,
  defaultDelayDirection,
  formatDelayLabel,
  isArboxDependentTriggerType,
  isAttendanceGapTriggerType,
  isBirthdayFamilyTriggerType,
  isImmediateDelayTrigger,
  isIncomingLeadTriggerType,
  minDelayDaysForTrigger,
  plannedCatalogEntriesForCell,
  PURCHASE_ITEM_TYPE_LABELS_HE,
  PURCHASE_ITEM_TYPE_VALUES,
  showsItemTypeFilter,
  showsProductFilter,
  TRIGGER_TYPE_OPTIONS,
  triggerCatalogEntry,
  triggerSendScheduleHintHe,
  triggerTypeLabel,
  type PurchaseItemType,
  type TriggerActivation,
  type TriggerAudience,
  type TriggerType,
} from "@/lib/trigger-catalog";
import {
  buildInlineTemplateDraft,
  defaultTriggerTemplateMode,
  isApprovedTemplateRow,
  shouldShowTriggerPendingPill,
  templateStatusForTriggerName,
  type TriggerTemplateMode,
} from "@/lib/trigger-inline-template";

export type TemplateRow = {
  id?: string;
  business_id?: number;
  waba_template_id?: string | null;
  name: string;
  category: string;
  language: string;
  status: string;
  disabled?: boolean;
  components?: unknown;
  created_at?: string;
  updated_at?: string;
};

export type { TriggerType };

export type DelayDirection = "after" | "before";

export type TriggerRow = {
  id: string;
  business_id: number;
  trigger_type: TriggerType;
  product_filter: number[] | null;
  item_type_filter: PurchaseItemType[] | null;
  delay_days: number;
  delay_direction: DelayDirection;
  template_name: string | null;
  enabled: boolean;
  created_at: string;
};

function isArboxTriggerType(type: TriggerType): boolean {
  return isArboxDependentTriggerType(type);
}

function isIncomingLeadType(type: string): boolean {
  return isIncomingLeadTriggerType(type);
}

type Props = {
  slug: string;
  initialTemplates: TemplateRow[];
  initialLeadTemplateName: string | null;
  initialTriggers: TriggerRow[];
  leadsWebhookSecret: string;
  hasWaba: boolean;
  hasArbox: boolean;
};

function statusBadgeClass(status: string): string {
  const s = status.toUpperCase();
  if (s === "APPROVED") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (s === "REJECTED") return "bg-red-50 text-red-700 border-red-200";
  return "bg-amber-50 text-amber-800 border-amber-200";
}

function statusLabel(status: string): string {
  const s = status.toUpperCase();
  if (s === "APPROVED") return "מאושר";
  if (s === "REJECTED") return "נדחה";
  if (s === "PENDING") return "ממתין לאישור";
  return status || "—";
}

function buildMetaComponents(input: {
  body: string;
  header: string;
  footer: string;
  buttons: TemplateButtonDraft[];
  exampleValues?: string[];
}): unknown[] {
  const components: Record<string, unknown>[] = [];
  const header = input.header.trim();
  if (header) {
    components.push({ type: "HEADER", format: "TEXT", text: header });
  }

  const body = input.body.trim();
  const varCount = extractBodyVarCount(body);
  const bodyComp: Record<string, unknown> = { type: "BODY", text: body };
  if (varCount > 0) {
    const examples = Array.from({ length: varCount }, (_, i) => {
      const fromPreset = input.exampleValues?.[i]?.trim();
      if (fromPreset) return fromPreset;
      return i === 0 ? "דנה" : `ערך${i + 1}`;
    });
    bodyComp.example = { body_text: [examples] };
  }
  components.push(bodyComp);

  const footer = input.footer.trim();
  if (footer) {
    components.push({ type: "FOOTER", text: footer });
  }

  const buttons = input.buttons
    .map((b) => ({
      kind: b.kind,
      text: b.text.trim(),
      url: b.url.trim(),
    }))
    .filter((b) => b.text);
  if (buttons.length > 0) {
    components.push({
      type: "BUTTONS",
      buttons: buttons.map((b) =>
        b.kind === "URL"
          ? { type: "URL", text: b.text, url: b.url || "https://example.com" }
          : { type: "QUICK_REPLY", text: b.text }
      ),
    });
  }

  return components;
}

function ModalShell({
  title,
  onClose,
  children,
  widthClass = "max-w-lg",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  widthClass?: string;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[2147483000]">
      <button
        type="button"
        aria-label="סגירה"
        className="absolute inset-0 bg-black/35"
        onClick={onClose}
      />
      <div className="relative mx-auto mt-12 w-[92vw] max-h-[85vh] overflow-y-auto">
        <div
          className={`mx-auto ${widthClass} rounded-2xl bg-white shadow-xl border border-zinc-200 overflow-hidden`}
          role="dialog"
          aria-modal="true"
        >
          <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-zinc-900 text-right">{title}</p>
            <button
              type="button"
              className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100"
              onClick={onClose}
              aria-label="סגור"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="p-5 text-zinc-900" dir="rtl">
            {children}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-zinc-600">{label}</p>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            } catch {
              /* ignore */
            }
          }}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "הועתק" : "העתק"}
        </button>
      </div>
      <pre
        className="overflow-x-auto rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-[11px] leading-relaxed text-zinc-800 whitespace-pre-wrap break-all text-left"
        dir="ltr"
      >
        {text}
      </pre>
    </div>
  );
}

export default function TemplatesClient({
  slug,
  initialTemplates,
  initialLeadTemplateName,
  initialTriggers,
  leadsWebhookSecret,
  hasWaba,
  hasArbox,
}: Props) {
  const [templates, setTemplates] = useState<TemplateRow[]>(initialTemplates);
  const [leadTemplateName, setLeadTemplateName] = useState<string | null>(
    initialLeadTemplateName
  );
  const [triggers, setTriggers] = useState<TriggerRow[]>(initialTriggers);
  const [refreshing, setRefreshing] = useState(false);
  const [settingLead, setSettingLead] = useState<string | null>(null);
  const [togglingDisabled, setTogglingDisabled] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [triggerSaving, setTriggerSaving] = useState(false);
  const [triggerTogglingId, setTriggerTogglingId] = useState<string | null>(null);
  const [triggerDeletingId, setTriggerDeletingId] = useState<string | null>(null);
  const [editingTriggerId, setEditingTriggerId] = useState<string | null>(null);
  const [editDelayDays, setEditDelayDays] = useState(0);
  const [editDelayDirection, setEditDelayDirection] = useState<DelayDirection>("after");
  const [editTemplateName, setEditTemplateName] = useState("");
  const [triggerEditSaving, setTriggerEditSaving] = useState(false);

  const [axisActivation, setAxisActivation] = useState<TriggerActivation>("automatic");
  const [axisAudience, setAxisAudience] = useState<TriggerAudience>("leads");
  const [activeManualCampaign, setActiveManualCampaign] = useState<string | null>(null);

  const [newTriggerType, setNewTriggerType] = useState<TriggerType>(
    hasArbox ? "purchase" : "incoming_lead"
  );
  /** When set, inline create form is open on that creatable card (no dropdown). */
  const [createFormOpenFor, setCreateFormOpenFor] = useState<TriggerType | null>(null);
  const [newProductFilter, setNewProductFilter] = useState<number[]>([]);
  const [newProductFilterQuery, setNewProductFilterQuery] = useState("");
  const [newItemTypeFilter, setNewItemTypeFilter] = useState<PurchaseItemType[]>([]);
  const [newDelayDays, setNewDelayDays] = useState(0);
  const [newDelayDirection, setNewDelayDirection] = useState<DelayDirection>("after");
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTriggerEnabled, setNewTriggerEnabled] = useState(true);
  const [newTemplateMode, setNewTemplateMode] = useState<TriggerTemplateMode>("create_new");
  const [inlineDraft, setInlineDraft] = useState<TemplateDraftValue>(EMPTY_TEMPLATE_DRAFT);
  const [connectPrompt, setConnectPrompt] = useState<{
    templateName: string;
    purpose: TriggerType | "";
  } | null>(null);
  const addTriggerSectionRef = useRef<HTMLLIElement | null>(null);

  const [arboxMembershipTypes, setArboxMembershipTypes] = useState<ArboxMembershipTypeRow[]>([]);
  const [arboxMembershipTypesLoading, setArboxMembershipTypesLoading] = useState(false);
  const [arboxMembershipTypesError, setArboxMembershipTypesError] = useState<string | null>(null);

  const selectableTemplates = useMemo(
    () =>
      templates.filter((t) => {
        const st = String(t.status).toUpperCase();
        return t.disabled !== true && (st === "APPROVED" || st === "PENDING");
      }),
    [templates]
  );

  /** "Use existing" path — only APPROVED (no Meta re-submit / wait). */
  const approvedSelectableTemplates = useMemo(
    () => templates.filter((t) => isApprovedTemplateRow(t)),
    [templates]
  );

  const creatableCatalogEntries = useMemo(
    () =>
      creatableCatalogEntriesForCell({
        activation: axisActivation,
        audience: axisAudience,
        hasArbox,
        existingTriggerTypes: triggers.map((t) => t.trigger_type),
      }),
    [hasArbox, triggers, axisActivation, axisAudience]
  );

  const plannedCatalogEntries = useMemo(
    () =>
      plannedCatalogEntriesForCell({
        activation: axisActivation,
        audience: axisAudience,
      }),
    [axisActivation, axisAudience]
  );

  const axisCatalogEntries = useMemo(
    () => catalogEntriesFor({ activation: axisActivation, audience: axisAudience }),
    [axisActivation, axisAudience]
  );

  const filteredTriggers = useMemo(() => {
    if (axisActivation !== "automatic") return [];
    return triggers.filter((t) => triggerCatalogEntry(t.trigger_type)?.audience === axisAudience);
  }, [triggers, axisActivation, axisAudience]);

  const marketingTemplates = useMemo(
    () => templates.filter((t) => isApprovedMarketingTemplate(t)),
    [templates]
  );

  const enabledIncomingLead = useMemo(
    () => triggers.some((t) => isIncomingLeadType(t.trigger_type) && t.enabled),
    [triggers]
  );

  const incomingLeadWebhookUrl = useMemo(() => {
    const token = leadsWebhookSecret || "<leads_webhook_secret>";
    return `https://heyzoe.io/api/leads/incoming?token=${encodeURIComponent(token)}`;
  }, [leadsWebhookSecret]);

  const arboxMembershipTypeNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const row of arboxMembershipTypes) {
      map.set(row.membership_type_id, row.membership_type_name);
    }
    return map;
  }, [arboxMembershipTypes]);

  const visibleNewProductFilterTypes = useMemo(
    () =>
      filterArboxMembershipTypesByWords(
        arboxMembershipTypes,
        newProductFilterQuery,
        newProductFilter
      ),
    [arboxMembershipTypes, newProductFilterQuery, newProductFilter]
  );

  const showNewProductFilter = showsProductFilter(newTriggerType);
  const showNewItemTypeFilter = showsItemTypeFilter(newTriggerType);
  const isNewImmediateDelay = isImmediateDelayTrigger(newTriggerType);
  const hideNewDelayDirection = !allowsDelayBefore(newTriggerType) || isNewImmediateDelay;
  const newDelayDaysMin = minDelayDaysForTrigger(newTriggerType);

  useEffect(() => {
    if (createFormOpenFor == null) return;
    if (!creatableCatalogEntries.some((e) => e.type === createFormOpenFor)) {
      setCreateFormOpenFor(null);
      return;
    }
    if (newTriggerType !== createFormOpenFor) {
      setNewTriggerType(createFormOpenFor);
    }
  }, [creatableCatalogEntries, createFormOpenFor, newTriggerType]);

  useEffect(() => {
    setNewDelayDirection(defaultDelayDirection(newTriggerType));
    setNewDelayDays(defaultDelayDays(newTriggerType));
    if (!showsProductFilter(newTriggerType)) {
      setNewProductFilter([]);
      setNewProductFilterQuery("");
    }
    if (!showsItemTypeFilter(newTriggerType)) {
      setNewItemTypeFilter([]);
    }
  }, [newTriggerType]);

  useEffect(() => {
    if (!hasArbox || !showNewProductFilter) return;

    let cancelled = false;
    setArboxMembershipTypesLoading(true);
    setArboxMembershipTypesError(null);

    void (async () => {
      try {
        const res = await fetch(
          `/api/dashboard/arbox-membership-types?slug=${encodeURIComponent(slug)}`,
          { cache: "no-store" }
        );
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          types?: ArboxMembershipTypeRow[];
        };
        if (cancelled) return;
        if (!res.ok) {
          setArboxMembershipTypes([]);
          setArboxMembershipTypesError(String(json.error ?? "fetch_failed"));
          return;
        }
        setArboxMembershipTypes(Array.isArray(json.types) ? json.types : []);
      } catch {
        if (!cancelled) {
          setArboxMembershipTypes([]);
          setArboxMembershipTypesError("fetch_failed");
        }
      } finally {
        if (!cancelled) setArboxMembershipTypesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasArbox, showNewProductFilter, slug]);

  const reloadTriggers = useCallback(async () => {
    const res = await fetch(`/api/${encodeURIComponent(slug)}/triggers`, { cache: "no-store" });
    const j = (await res.json().catch(() => ({}))) as {
      triggers?: TriggerRow[];
      error?: string;
    };
    if (!res.ok) {
      throw new Error(j.error || `http_${res.status}`);
    }
    setTriggers(Array.isArray(j.triggers) ? j.triggers : []);
  }, [slug]);

  function toggleNewProductFilter(id: number) {
    setNewProductFilter((prev) => {
      const has = prev.includes(id);
      const next = has ? prev.filter((x) => x !== id) : [...prev, id];
      return next.sort((a, b) => a - b);
    });
  }

  function toggleNewItemTypeFilter(value: PurchaseItemType) {
    setNewItemTypeFilter((prev) => {
      const has = prev.includes(value);
      const next = has ? prev.filter((x) => x !== value) : [...prev, value];
      return next.sort();
    });
  }

  function formatProductFilterLabel(ids: number[] | null): string {
    if (!ids || ids.length === 0) return "כל המוצרים";
    return ids
      .map((id) => {
        const name = arboxMembershipTypeNameById.get(id);
        return name ? `${id} — ${name}` : String(id);
      })
      .join(", ");
  }

  function formatItemTypeFilterLabel(types: PurchaseItemType[] | null | undefined): string {
    if (!types || types.length === 0) return "כל הסוגים";
    return types.map((t) => PURCHASE_ITEM_TYPE_LABELS_HE[t] ?? t).join(", ");
  }

  function applyInlinePresetForType(type: TriggerType) {
    const draft = buildInlineTemplateDraft(
      type,
      templates.map((t) => t.name)
    );
    setInlineDraft(draft ?? EMPTY_TEMPLATE_DRAFT);
  }

  async function postTriggerRow(input: {
    trigger_type: TriggerType;
    template_name: string | null;
    enabled: boolean;
  }): Promise<TriggerRow | null> {
    const res = await fetch(`/api/${encodeURIComponent(slug)}/triggers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trigger_type: input.trigger_type,
        product_filter: showNewProductFilter && newProductFilter.length > 0 ? newProductFilter : null,
        item_type_filter:
          showNewItemTypeFilter && newItemTypeFilter.length > 0 ? newItemTypeFilter : null,
        delay_days: isNewImmediateDelay
          ? 0
          : Math.max(newDelayDaysMin, newDelayDays),
        delay_direction: hideNewDelayDirection ? "after" : newDelayDirection,
        template_name: input.template_name,
        enabled: input.enabled,
      }),
    });
    const j = (await res.json().catch(() => ({}))) as {
      trigger?: TriggerRow;
      error?: string;
    };
    if (!res.ok) {
      if (j.error === "template_not_approved") {
        throw new Error("הטמפלייט לא זמין לטריגר — בחרו טמפלייט אחר");
      }
      if (j.error === "template_disabled") {
        throw new Error("הטמפלייט מושבת — בחרו טמפלייט פעיל או הפעילו מחדש");
      }
      if (j.error === "min_delay_days") {
        throw new Error("לחזרה אחרי שתיקה נדרשים לפחות 2 ימים");
      }
      if (j.error === "arbox_not_connected") {
        throw new Error("יש לחבר Arbox בהגדרות לפני יצירת טריגרים");
      }
      if (j.error === "incoming_lead_exists") {
        throw new Error("כבר קיים טריגר ליד");
      }
      if (j.error === "arbox_new_lead_exists") {
        throw new Error("כבר קיים טריגר ליד חדש מארבוקס — ערכו את הקיים במקום ליצור עוד אחד");
      }
      if (j.error === "trial_reminder_exists") {
        throw new Error("כבר קיים טריגר תזכורת לשיעור ניסיון — ערכו את הקיים במקום ליצור עוד אחד");
      }
      throw new Error(j.error || `http_${res.status}`);
    }
    return j.trigger ?? null;
  }

  async function onCreateTrigger(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setTriggerSaving(true);
    try {
      let templateName =
        newTemplateMode === "use_existing" ? newTemplateName.trim() || null : null;

      if (newTemplateMode === "create_new") {
        if (!hasWaba) {
          throw new Error("אין WABA מחובר לעסק — חברו WhatsApp לפני יצירת טמפלייט");
        }
        const name = inlineDraft.name.trim().toLowerCase();
        if (!TEMPLATE_NAME_RE.test(name)) {
          throw new Error("שם טמפלייט לא תקין (a-z, 0-9 ו־_ בלבד)");
        }
        if (!inlineDraft.body.trim()) {
          throw new Error("גוף ההודעה חובה");
        }
        const exampleValues = paramSlotsForTriggerType(newTriggerType).map(presetExampleForSlot);
        const components = buildMetaComponents({
          body: inlineDraft.body,
          header: inlineDraft.header,
          footer: inlineDraft.footer,
          buttons: inlineDraft.buttons,
          exampleValues,
        });
        const tplRes = await fetch(`/api/${encodeURIComponent(slug)}/templates`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            category: inlineDraft.category,
            language: inlineDraft.language || "he",
            components,
          }),
        });
        const tplJson = (await tplRes.json().catch(() => ({}))) as {
          template?: TemplateRow;
          error?: string;
          detail?: string;
        };
        if (!tplRes.ok) {
          if (tplJson.error === "invalid_template_name") {
            throw new Error("שם טמפלייט לא תקין");
          }
          if (tplJson.error === "no_waba") {
            throw new Error("אין WABA מחובר לעסק — חברו WhatsApp קודם");
          }
          throw new Error(tplJson.detail || tplJson.error || `http_${tplRes.status}`);
        }
        const created = tplJson.template;
        if (created) {
          setTemplates((prev) => {
            const without = prev.filter((t) => t.name !== created.name);
            return [created, ...without];
          });
        }
        templateName = String(created?.name ?? name).trim();
        try {
          const trigger = await postTriggerRow({
            trigger_type: newTriggerType,
            template_name: templateName,
            enabled: newTriggerEnabled,
          });
          if (trigger) {
            setTriggers((prev) =>
              [...prev, trigger].sort(
                (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
              )
            );
          } else {
            await reloadTriggers();
          }
          setSuccess(
            newTriggerEnabled
              ? "הטריגר נוסף — ישלח אוטומטית אחרי אישור Meta לטמפלייט"
              : "הטריגר נוסף (כבוי) עם טמפלייט ממתין לאישור Meta"
          );
        } catch (triggerErr) {
          setNewTemplateMode("use_existing");
          setNewTemplateName(templateName);
          throw new Error(
            `${triggerErr instanceof Error ? triggerErr.message : "שמירת טריגר נכשלה"} — הטמפלייט «${templateName}» כבר נוצר במטא; בחרו אותו ב«טמפלייט קיים» ונסו שוב.`
          );
        }
      } else {
        const trigger = await postTriggerRow({
          trigger_type: newTriggerType,
          template_name: templateName,
          enabled: newTriggerEnabled,
        });
        if (trigger) {
          setTriggers((prev) =>
            [...prev, trigger].sort(
              (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            )
          );
        } else {
          await reloadTriggers();
        }
        setSuccess("הטריגר נוסף");
      }

      setCreateFormOpenFor(null);
      setNewProductFilter([]);
      setNewProductFilterQuery("");
      setNewItemTypeFilter([]);
      setNewDelayDays(0);
      setNewDelayDirection("after");
      setNewTemplateName("");
      setNewTriggerEnabled(true);
      setNewTemplateMode("create_new");
      setInlineDraft(EMPTY_TEMPLATE_DRAFT);
    } catch (err) {
      setError(err instanceof Error ? err.message : "שמירת טריגר נכשלה");
    } finally {
      setTriggerSaving(false);
    }
  }

  async function onToggleTrigger(trigger: TriggerRow, enabled: boolean) {
    setError(null);
    setTriggerTogglingId(trigger.id);
    try {
      const res = await fetch(`/api/${encodeURIComponent(slug)}/triggers`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: trigger.id, enabled }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        trigger?: TriggerRow;
        error?: string;
      };
      if (!res.ok) throw new Error(j.error || `http_${res.status}`);
      if (j.trigger) {
        setTriggers((prev) => prev.map((row) => (row.id === j.trigger!.id ? j.trigger! : row)));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "עדכון טריגר נכשל");
    } finally {
      setTriggerTogglingId(null);
    }
  }

  async function onDeleteTrigger(id: string) {
    setError(null);
    setTriggerDeletingId(id);
    try {
      const res = await fetch(
        `/api/${encodeURIComponent(slug)}/triggers?id=${encodeURIComponent(String(id))}`,
        { method: "DELETE" }
      );
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error || `http_${res.status}`);
      setTriggers((prev) => prev.filter((row) => row.id !== id));
      if (editingTriggerId === id) setEditingTriggerId(null);
      setSuccess("הטריגר נמחק");
    } catch (err) {
      setError(err instanceof Error ? err.message : "מחיקת טריגר נכשלה");
    } finally {
      setTriggerDeletingId(null);
    }
  }

  function startEditTrigger(trigger: TriggerRow) {
    setError(null);
    setSuccess(null);
    setEditingTriggerId(trigger.id);
    setEditDelayDays(trigger.delay_days);
    setEditDelayDirection(
      trigger.delay_direction === "before" ? "before" : "after"
    );
    setEditTemplateName(trigger.template_name ?? "");
  }

  async function onSaveTriggerEdit(trigger: TriggerRow) {
    setError(null);
    setSuccess(null);
    setTriggerEditSaving(true);
    try {
      const immediate = isImmediateDelayTrigger(trigger.trigger_type);
      const delayMin = trigger.trigger_type === "no_response" ? 2 : 0;
      const delayDays = immediate
        ? 0
        : Math.max(delayMin, Math.trunc(Number(editDelayDays) || 0));
      const body: Record<string, unknown> = {
        id: trigger.id,
        delay_days: delayDays,
        template_name: editTemplateName.trim() || null,
      };
      if (allowsDelayBefore(trigger.trigger_type) && !immediate) {
        body.delay_direction = editDelayDirection;
      }
      const res = await fetch(`/api/${encodeURIComponent(slug)}/triggers`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as {
        trigger?: TriggerRow;
        error?: string;
      };
      if (!res.ok) {
        if (j.error === "template_not_approved") {
          throw new Error("הטמפלייט לא זמין לטריגר — בחרו טמפלייט אחר");
        }
        throw new Error(j.error || `http_${res.status}`);
      }
      if (j.trigger) {
        setTriggers((prev) => prev.map((row) => (row.id === j.trigger!.id ? j.trigger! : row)));
      }
      setEditingTriggerId(null);
      setSuccess("הטריגר עודכן");
    } catch (err) {
      setError(err instanceof Error ? err.message : "עדכון טריגר נכשל");
    } finally {
      setTriggerEditSaving(false);
    }
  }

  const [showCreate, setShowCreate] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<TemplateRow | null>(null);
  const [editExampleValues, setEditExampleValues] = useState<string[]>([]);
  const [showAutomation, setShowAutomation] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createSuccess, setCreateSuccess] = useState(false);

  const [name, setName] = useState("");
  const [category, setCategory] = useState<"MARKETING" | "UTILITY">("MARKETING");
  const [language, setLanguage] = useState("he");
  const [body, setBody] = useState("");
  const [header, setHeader] = useState("");
  const [footer, setFooter] = useState("");
  const [buttons, setButtons] = useState<TemplateButtonDraft[]>(EMPTY_TEMPLATE_BUTTONS);
  const [purposeTrigger, setPurposeTrigger] = useState<TriggerType | "">("");
  const isEditing = editingTemplate != null;
  const categoryLocked =
    isEditing && String(editingTemplate.status).toUpperCase() === "APPROVED";

  const purposeOptions = useMemo(
    () => TRIGGER_TYPE_OPTIONS.filter((opt) => isPresetAvailable(opt.value, hasArbox)),
    [hasArbox]
  );

  function applyPurposePreset(type: TriggerType | "") {
    setPurposeTrigger(type);
    if (!type) return;
    const preset = TEMPLATE_PRESETS[type];
    if (!preset) return;
    setName(uniqueTemplateName(preset.name, templates.map((t) => t.name)));
    setCategory(preset.category);
    setBody(preset.body);
    if (preset.button_text) {
      setButtons([{ kind: "QUICK_REPLY", text: preset.button_text, url: "" }]);
    } else {
      setButtons([...EMPTY_TEMPLATE_BUTTONS]);
    }
  }

  function resetCreateForm() {
    setName("");
    setBody("");
    setHeader("");
    setFooter("");
    setButtons([...EMPTY_TEMPLATE_BUTTONS]);
    setCategory("MARKETING");
    setLanguage("he");
    setPurposeTrigger("");
    setEditingTemplate(null);
    setEditExampleValues([]);
  }

  function openCreateModal() {
    setError(null);
    resetCreateForm();
    setShowCreate(true);
  }

  function openEditModal(t: TemplateRow) {
    setError(null);
    setSuccess(null);
    if (!hasWaba) {
      setError("אין WABA מחובר לעסק — אי אפשר לערוך טמפלייטים עד שתתחברו ל־WhatsApp.");
      return;
    }
    if (!String(t.waba_template_id ?? "").trim()) {
      setError("חסר מזהה מטא לטמפלייט — לחצו «רענן» ואז נסו שוב.");
      return;
    }
    if (!isMetaTemplateContentEditable(t.status)) {
      const s = String(t.status).toUpperCase();
      if (s === "PENDING") {
        setError("הטמפלייט ממתין לאישור מטא — אפשר לערוך אחרי שתתקבל תשובה.");
      } else {
        setError("אי אפשר לערוך טמפלייט במצב הזה.");
      }
      return;
    }
    const draft = parseDashboardTemplateComponents(t.components);
    if (!draft) {
      setError(
        "לא ניתן לערוך טמפלייט זה מהדשבורד — הוא מכיל רכיבים מתקדמים (תמונה, כפתור מיוחד וכו׳)."
      );
      return;
    }
    setEditingTemplate(t);
    setName(t.name);
    setCategory(t.category.toUpperCase() === "UTILITY" ? "UTILITY" : "MARKETING");
    setLanguage(t.language || "he");
    setBody(draft.body);
    setHeader(draft.header);
    setFooter(draft.footer);
    setButtons(draft.buttons);
    setEditExampleValues(draft.exampleValues);
    setPurposeTrigger("");
    setShowCreate(true);
  }

  const canSubmitCreate =
    (isEditing || TEMPLATE_NAME_RE.test(name)) &&
    body.trim().length > 0 &&
    hasWaba &&
    !creating;

  const incomingUrl = "https://heyzoe.io/api/leads/incoming";
  const zapierBodyExample = useMemo(
    () =>
      JSON.stringify(
        { full_name: "<map lead name>", phone: "<map lead phone>" },
        null,
        2
      ),
    []
  );
  const curlExample = useMemo(() => {
    const secret = leadsWebhookSecret || "<leads_webhook_secret>";
    return [
      `curl -X POST ${incomingUrl} \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -H "x-leads-secret: ${secret}" \\`,
      `  -d '{"full_name":"דנה","phone":"0501234567"}'`,
    ].join("\n");
  }, [leadsWebhookSecret]);

  const reloadFromApi = useCallback(
    async (refresh: boolean) => {
      const qs = refresh ? "?refresh=1" : "";
      const res = await fetch(`/api/${encodeURIComponent(slug)}/templates${qs}`, {
        cache: "no-store",
      });
      const j = (await res.json().catch(() => ({}))) as {
        templates?: TemplateRow[];
        lead_template_name?: string | null;
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        throw new Error(j.detail || j.error || `http_${res.status}`);
      }
      setTemplates(Array.isArray(j.templates) ? j.templates : []);
      if (j.lead_template_name !== undefined) {
        setLeadTemplateName(j.lead_template_name ? String(j.lead_template_name) : null);
      }
    },
    [slug]
  );

  async function onRefresh() {
    setError(null);
    setSuccess(null);
    setRefreshing(true);
    try {
      await reloadFromApi(true);
      setSuccess("הרשימה סונכרנה מ-Meta");
    } catch (e) {
      setError(e instanceof Error ? e.message : "רענון נכשל");
    } finally {
      setRefreshing(false);
    }
  }

  async function onSetLead(templateName: string) {
    setError(null);
    setSuccess(null);
    setSettingLead(templateName);
    try {
      const res = await fetch(`/api/${encodeURIComponent(slug)}/templates/set-lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_name: templateName }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        lead_template_name?: string;
        error?: string;
      };
      if (!res.ok) {
        if (j.error === "template_not_approved") {
          throw new Error("אפשר להגדיר רק טמפלייט שאושר במטא");
        }
        if (j.error === "template_disabled") {
          throw new Error("הטמפלייט מושבת — הפעילו מחדש לפני הגדרה כטמפלייט פתיחה");
        }
        throw new Error(j.error || `http_${res.status}`);
      }
      setLeadTemplateName(String(j.lead_template_name ?? templateName));
      setSuccess(`«${templateName}» הוגדר כטמפלייט הפתיחה ללידים`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "עדכון נכשל");
    } finally {
      setSettingLead(null);
    }
  }

  function templateUsageWarning(templateName: string): string | null {
    const asLead = leadTemplateName != null && leadTemplateName === templateName;
    const activeTriggers = triggers.filter(
      (t) => t.enabled && String(t.template_name ?? "").trim() === templateName
    );
    if (!asLead && activeTriggers.length === 0) return null;
    const parts: string[] = [];
    if (asLead) parts.push("טמפלייט הפתיחה ללידים");
    if (activeTriggers.length > 0) {
      parts.push(
        activeTriggers.length === 1
          ? "טריגר פעיל"
          : `${activeTriggers.length} טריגרים פעילים`
      );
    }
    return `טמפלייט זה בשימוש ב${parts.join(" ו־")} — השבתתו תמנע את שליחתו. להמשיך?`;
  }

  async function onToggleDisabled(t: TemplateRow) {
    const nextDisabled = t.disabled !== true;
    const rowKey = `${t.id ?? t.name}:${t.language}`;

    if (nextDisabled) {
      const warning = templateUsageWarning(t.name);
      if (warning && !window.confirm(warning)) return;
    }

    setError(null);
    setSuccess(null);
    setTogglingDisabled(rowKey);
    try {
      const res = await fetch(`/api/${encodeURIComponent(slug)}/templates`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(t.id ? { id: t.id } : { name: t.name, language: t.language }),
          disabled: nextDisabled,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        template?: TemplateRow;
      };
      if (!res.ok) {
        throw new Error(j.error || `http_${res.status}`);
      }
      const updated = j.template;
      setTemplates((prev) =>
        prev.map((row) => {
          const same =
            (t.id && row.id === t.id) ||
            (!t.id && row.name === t.name && row.language === t.language);
          if (!same) return row;
          return updated ? { ...row, ...updated } : { ...row, disabled: nextDisabled };
        })
      );
      setSuccess(nextDisabled ? "הטמפלייט הושבת (רק אצלנו)" : "הטמפלייט הופעל מחדש");
    } catch (e) {
      setError(e instanceof Error ? e.message : "עדכון השבתה נכשל");
    } finally {
      setTogglingDisabled(null);
    }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreateSuccess(false);
    if (!isEditing && !TEMPLATE_NAME_RE.test(name)) {
      setError("שם טמפלייט לא תקין");
      return;
    }
    if (!body.trim()) {
      setError("גוף ההודעה חובה");
      return;
    }
    if (editingTemplate && String(editingTemplate.status).toUpperCase() === "APPROVED") {
      const warning = templateUsageWarning(editingTemplate.name);
      const confirmMsg = warning
        ? `לאחר השמירה מטא תבדוק את הטמפלייט מחדש והוא לא יישלח עד האישור. ${warning}`
        : "לאחר השמירה מטא תבדוק את הטמפלייט מחדש — עד האישור הוא לא יישלח ללקוחות. להמשיך?";
      if (!window.confirm(confirmMsg)) return;
    }
    setCreating(true);
    try {
      const exampleValues = purposeTrigger
        ? paramSlotsForTriggerType(purposeTrigger).map(presetExampleForSlot)
        : isEditing && editExampleValues.length > 0
          ? editExampleValues
          : undefined;
      const components = buildMetaComponents({
        body,
        header,
        footer,
        buttons,
        exampleValues,
      });
      const res = await fetch(`/api/${encodeURIComponent(slug)}/templates`, {
        method: isEditing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editingTemplate
            ? {
                ...(editingTemplate.id
                  ? { id: editingTemplate.id }
                  : { name: editingTemplate.name, language: editingTemplate.language }),
                category,
                components,
              }
            : {
                name,
                category,
                language,
                components,
              }
        ),
      });
      const j = (await res.json().catch(() => ({}))) as {
        template?: TemplateRow;
        error?: string;
        detail?: string;
      };
      if (!res.ok) {
        if (j.error === "invalid_template_name") throw new Error("שם טמפלייט לא תקין");
        if (j.error === "no_waba") throw new Error("אין WABA מחובר לעסק — חברו WhatsApp קודם");
        if (j.error === "template_not_editable") {
          throw new Error("אי אפשר לערוך טמפלייט במצב הזה (ממתין לאישור / נמחק).");
        }
        if (j.error === "missing_waba_template_id") {
          throw new Error("חסר מזהה מטא — לחצו «רענן» ואז נסו שוב.");
        }
        if (j.error === "category_locked") {
          throw new Error("אי אפשר לשנות קטגוריה של טמפלייט שכבר אושר.");
        }
        throw new Error(j.detail || j.error || `http_${res.status}`);
      }
      if (isEditing) {
        setCreateSuccess(true);
        setSuccess("העריכה נשלחה לאישור מטא");
        await reloadFromApi(false);
        window.setTimeout(() => {
          setShowCreate(false);
          setCreateSuccess(false);
          resetCreateForm();
        }, 900);
      } else {
        const createdName = String(j.template?.name ?? name).trim();
        const createdPurpose = purposeTrigger;
        await reloadFromApi(false);
        setShowCreate(false);
        setCreateSuccess(false);
        resetCreateForm();
        setConnectPrompt({ templateName: createdName, purpose: createdPurpose });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : isEditing ? "עריכה נכשלה" : "יצירה נכשלה");
    } finally {
      setCreating(false);
    }
  }

  function closeConnectPrompt() {
    setConnectPrompt(null);
  }

  function startCreateTrigger(type: TriggerType, opts?: { preferExistingName?: string }) {
    setError(null);
    setNewTriggerType(type);
    setCreateFormOpenFor(type);
    applyInlinePresetForType(type);
    const mode = defaultTriggerTemplateMode({
      preferExistingName: opts?.preferExistingName,
      hasApprovedTemplate: approvedSelectableTemplates.length > 0,
    });
    setNewTemplateMode(mode);
    if (mode === "use_existing" && opts?.preferExistingName) {
      setNewTemplateName(opts.preferExistingName);
    } else {
      setNewTemplateName("");
    }
  }

  function closeCreateTriggerForm() {
    setCreateFormOpenFor(null);
    setNewTemplateMode("create_new");
    setInlineDraft(EMPTY_TEMPLATE_DRAFT);
    setNewTemplateName("");
  }

  function onConnectToTrigger() {
    const prompt = connectPrompt;
    setConnectPrompt(null);
    if (prompt?.purpose && creatableCatalogEntries.some((e) => e.type === prompt.purpose)) {
      startCreateTrigger(prompt.purpose, {
        preferExistingName: prompt.templateName || undefined,
      });
    } else if (prompt?.templateName) {
      setNewTemplateMode("use_existing");
      setNewTemplateName(prompt.templateName);
    }
    window.setTimeout(() => {
      addTriggerSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  return (
    <div
      className={`${DASHBOARD_SETTINGS_SHELL} ${DASHBOARD_CENTERED_CONTENT} space-y-6`}
      dir="rtl"
      style={{ fontFamily: '"Fredoka", system-ui, sans-serif' }}
    >
      <header className="space-y-2 text-right">
        <h1 className="text-2xl font-semibold text-zinc-900 sm:text-3xl">טמפלייטים</h1>
        <p className="text-sm leading-relaxed text-zinc-600 sm:text-[15px]">
          טמפלייטים הם הודעות מוכנות מראש שחייבות אישור של Meta כדי לשלוח בוואטסאפ מחוץ לחלון 24
          השעות. כל טמפלייט עובר אישור במטא (לרוב כמה דקות). שליחת טמפלייט שיווקי (Marketing)
          למספר ישראלי עולה כ־₪0.13 להודעה (נתון לשינוי ע״י Meta).
        </p>
      </header>

      <section className="rounded-2xl border border-[#7133da]/25 bg-[#7133da]/5 p-4 sm:p-5 shadow-sm">
        <p className="text-sm leading-relaxed text-zinc-800 sm:text-[15px]">
          מריצים קמפיין לידים ורוצים שזואי תשלח הודעת ווטסאפ לליד שהשאיר פרטים? צרו טמפלייט פתיחה
          שישלח אוטומטית והוסיפו את זואי לאוטומציה שלכם.
        </p>
        <button
          type="button"
          onClick={() => setShowAutomation(true)}
          className="mt-3 inline-flex items-center rounded-xl bg-[#7133da] px-4 py-2 text-sm font-medium text-white hover:bg-[#5f28c0]"
        >
          איך מחברים לאוטומציה?
        </button>
      </section>

      {(error || success) && (
        <div
          className={`rounded-xl border px-3 py-2 text-sm ${
            error
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {error || success}
        </div>
      )}

      <section className="rounded-2xl border border-[#7133da]/20 bg-white/85 p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-zinc-900">הטמפלייטים שלכם</h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
            >
              {refreshing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              רענן
            </button>
            <button
              type="button"
              onClick={() => openCreateModal()}
              className="inline-flex items-center rounded-xl bg-[#7133da] px-3 py-2 text-sm font-medium text-white hover:bg-[#5f28c0]"
            >
              צור טמפלייט חדש
            </button>
          </div>
        </div>

        {!hasWaba && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            אין WABA מחובר לעסק — אי אפשר ליצור, לערוך או לרענן טמפלייטים ממטא עד שתתחברו ל־WhatsApp.
          </p>
        )}

        {templates.length === 0 ? (
          <p className="text-sm text-zinc-500">עדיין אין טמפלייטים. צרו אחד חדש או לחצו «רענן».</p>
        ) : (
          <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-100 overflow-hidden">
            {templates.map((t) => {
              const isApproved = String(t.status).toUpperCase() === "APPROVED";
              const isDisabled = t.disabled === true;
              const isCurrent = leadTemplateName != null && leadTemplateName === t.name;
              const toggleKey = `${t.id ?? t.name}:${t.language}`;
              const bodyPreview = bodyTextFromTemplateComponents(t.components);
              return (
                <li
                  key={`${t.name}:${t.language}:${t.id ?? t.waba_template_id ?? ""}`}
                  className={`flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4 ${
                    isDisabled ? "bg-zinc-50" : "bg-white"
                  }`}
                >
                  <div className="space-y-1 text-right min-w-0">
                    <p className="font-medium text-zinc-900 break-all" dir="ltr">
                      {t.name}
                    </p>
                    {bodyPreview ? (
                      <p className="text-sm text-zinc-600 line-clamp-2 whitespace-pre-wrap">
                        {bodyPreview}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 font-medium ${statusBadgeClass(
                          t.status
                        )}`}
                      >
                        {statusLabel(t.status)}
                      </span>
                      {isDisabled ? (
                        <span className="inline-flex rounded-full border border-zinc-300 bg-zinc-100 px-2 py-0.5 font-medium text-zinc-700">
                          מושבת
                        </span>
                      ) : null}
                      <span>{t.category || "—"}</span>
                      <span>{t.language || "—"}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => openEditModal(t)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
                    >
                      <Pencil className="h-4 w-4" />
                      ערוך
                    </button>
                    <button
                      type="button"
                      disabled={togglingDisabled === toggleKey}
                      onClick={() => void onToggleDisabled(t)}
                      className={`rounded-xl border px-3 py-2 text-sm disabled:opacity-60 ${
                        isDisabled
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                          : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                      }`}
                    >
                      {togglingDisabled === toggleKey ? (
                        <span className="inline-flex items-center gap-1">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          מעדכן…
                        </span>
                      ) : isDisabled ? (
                        "הפעל מחדש"
                      ) : (
                        "השבת"
                      )}
                    </button>
                    {isApproved && !isDisabled ? (
                      isCurrent ? (
                        <span className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
                          <Check className="h-4 w-4" />
                          טמפלייט הפתיחה הנוכחי
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={settingLead === t.name}
                          onClick={() => void onSetLead(t.name)}
                          className="rounded-xl border border-[#7133da]/30 bg-white px-3 py-2 text-sm text-[#7133da] hover:bg-[#7133da]/5 disabled:opacity-60"
                        >
                          {settingLead === t.name ? (
                            <span className="inline-flex items-center gap-1">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              מגדיר…
                            </span>
                          ) : (
                            "הגדר כטמפלייט פתיחה ללידים"
                          )}
                        </button>
                      )
                    ) : isApproved && isDisabled && isCurrent ? (
                      <span className="inline-flex items-center gap-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
                        טמפלייט פתיחה (מושבת)
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-[#7133da]/20 bg-white/85 p-4 sm:p-5 shadow-sm space-y-4">
        <div className="text-right space-y-4">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">טריגרים וקמפיינים</h2>
            <p className="mt-1 text-xs text-zinc-500">
              מציגים כעת: {ACTIVATION_LABELS_HE[axisActivation]} · {AUDIENCE_LABELS_HE[axisAudience]}
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex flex-col items-start gap-1.5">
              <p className="text-[11px] font-medium text-zinc-500">הפעלה</p>
              <nav
                className="flex min-w-0 justify-start overflow-x-auto pb-0.5"
                aria-label="סוג הפעלה"
                dir="rtl"
              >
                <div
                  className="inline-flex min-w-max items-center gap-0.5 rounded-2xl bg-zinc-100/80 p-1 sm:gap-1"
                  role="tablist"
                >
                  {(["automatic", "manual"] as const).map((act) => {
                    const active = axisActivation === act;
                    return (
                      <button
                        key={act}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => {
                          setAxisActivation(act);
                          setActiveManualCampaign(null);
                        }}
                        className={[
                          dashboardStepTabClass(active),
                          "inline-flex items-center rounded-xl px-3 py-2 sm:px-4",
                          active ? "bg-white shadow-sm ring-1 ring-[#7133da]/15" : "hover:bg-white/60",
                        ].join(" ")}
                      >
                        {ACTIVATION_LABELS_HE[act]}
                      </button>
                    );
                  })}
                </div>
              </nav>
            </div>

            <div className="flex flex-col items-start gap-1.5">
              <p className="text-[11px] font-medium text-zinc-500">קהל</p>
              <nav
                className="flex min-w-0 justify-start overflow-x-auto pb-0.5"
                aria-label="קהל יעד"
                dir="rtl"
              >
                <div
                  className="inline-flex min-w-max items-center gap-0.5 rounded-2xl bg-zinc-100/80 p-1 sm:gap-1"
                  role="tablist"
                >
                  {(["leads", "members", "staff"] as const).map((aud) => {
                    const active = axisAudience === aud;
                    return (
                      <button
                        key={aud}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => {
                          setAxisAudience(aud);
                          setActiveManualCampaign(null);
                        }}
                        className={[
                          dashboardStepTabClass(active),
                          "inline-flex items-center rounded-xl px-3 py-2 sm:px-4",
                          active ? "bg-white shadow-sm ring-1 ring-[#7133da]/15" : "hover:bg-white/60",
                        ].join(" ")}
                      >
                        {AUDIENCE_LABELS_HE[aud]}
                      </button>
                    );
                  })}
                </div>
              </nav>
            </div>
          </div>
        </div>

        {axisAudience === "staff" ? (
          <p className="text-sm text-zinc-500 text-right">
            טריגרי צוות יגיעו כאן בקרוב.
          </p>
        ) : null}

        {axisActivation === "automatic" && axisAudience !== "staff" ? (
          <>
            {!hasArbox ? (
              <p className="text-sm leading-relaxed text-zinc-700 rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-right">
                טריגרים מבוססי Arbox (רכישה, יום הולדת וכו׳) דורשים חיבור CRM.{" "}
                <Link
                  href={settingsStepHref(`/${encodeURIComponent(slug)}/settings`, 1, "he", {
                    section: "crm",
                  })}
                  className="font-medium text-[#7133da] hover:underline"
                >
                  חברו את Arbox בהגדרות
                </Link>
                . טריגר «ליד מאתר/קמפיין» זמין תמיד.
              </p>
            ) : null}

            <ul className="space-y-3">
              {filteredTriggers.map((trigger) => (
                <li
                  key={trigger.id}
                  className={`rounded-xl border px-3 py-3 sm:px-4 ${
                    trigger.enabled
                      ? "border-zinc-200 bg-white"
                      : "border-zinc-100 bg-zinc-50 opacity-80"
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1.5 text-right min-w-0 flex-1">
                      <p className="font-medium text-zinc-900">
                        {triggerTypeLabel(trigger.trigger_type)}
                      </p>
                      {showsProductFilter(trigger.trigger_type) ? (
                        <p className="text-xs text-zinc-600">
                          מוצרים: {formatProductFilterLabel(trigger.product_filter)}
                        </p>
                      ) : null}
                      {showsItemTypeFilter(trigger.trigger_type) ? (
                        <p className="text-xs text-zinc-600">
                          סוג רכישה: {formatItemTypeFilterLabel(trigger.item_type_filter)}
                        </p>
                      ) : null}
                      <p className="text-xs text-zinc-600">
                        תזמון:{" "}
                        {formatDelayLabel(
                          trigger.trigger_type,
                          trigger.delay_days,
                          trigger.delay_direction
                        )}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {triggerSendScheduleHintHe(trigger.trigger_type)}
                      </p>
                      <p className="text-xs text-zinc-600 break-all" dir="ltr">
                        טמפלייט: {trigger.template_name || "—"}
                      </p>
                      {shouldShowTriggerPendingPill(
                        templateStatusForTriggerName(templates, trigger.template_name)
                      ) ? (
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(
                            "PENDING"
                          )}`}
                        >
                          ממתין לאישור
                        </span>
                      ) : null}
                      {editingTriggerId === trigger.id ? (
                        <div className="mt-2 space-y-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                          {isImmediateDelayTrigger(trigger.trigger_type) ? (
                            <p className="text-xs text-zinc-600">נשלח מיד עם האירוע.</p>
                          ) : (
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                              <div className="space-y-1">
                                <label className="text-xs font-medium text-zinc-700">
                                  {isAttendanceGapTriggerType(trigger.trigger_type)
                                    ? "ימי היעדרות"
                                    : "השהייה (ימים)"}
                                </label>
                                <input
                                  type="number"
                                  min={minDelayDaysForTrigger(trigger.trigger_type)}
                                  value={editDelayDays}
                                  onChange={(e) => setEditDelayDays(Number(e.target.value))}
                                  className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm"
                                />
                              </div>
                              {allowsDelayBefore(trigger.trigger_type) ? (
                                <div className="space-y-1">
                                  <label className="text-xs font-medium text-zinc-700">כיוון</label>
                                  <select
                                    value={editDelayDirection}
                                    onChange={(e) =>
                                      setEditDelayDirection(e.target.value as DelayDirection)
                                    }
                                    className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm"
                                  >
                                    {isBirthdayFamilyTriggerType(trigger.trigger_type) ? (
                                      <>
                                        <option value="before">לפני יום ההולדת</option>
                                        <option value="after">אחרי יום ההולדת</option>
                                      </>
                                    ) : (
                                      <>
                                        <option value="before">לפני פקיעת התוקף</option>
                                        <option value="after">אחרי פקיעת התוקף</option>
                                      </>
                                    )}
                                  </select>
                                </div>
                              ) : null}
                            </div>
                          )}
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-zinc-700">טמפלייט</label>
                            <select
                              value={editTemplateName}
                              onChange={(e) => setEditTemplateName(e.target.value)}
                              className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-sm text-right"
                              dir="rtl"
                              style={{ textAlignLast: "right" }}
                            >
                              <option value="">— ללא טמפלייט —</option>
                              {selectableTemplates.map((t) => (
                                <option key={t.name} value={t.name}>
                                  {t.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setEditingTriggerId(null)}
                              className="rounded-lg border border-zinc-200 px-2.5 py-1 text-xs text-zinc-700"
                            >
                              ביטול
                            </button>
                            <button
                              type="button"
                              disabled={triggerEditSaving}
                              onClick={() => void onSaveTriggerEdit(trigger)}
                              className="inline-flex items-center gap-1 rounded-lg bg-[#7133da] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-60"
                            >
                              {triggerEditSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                              שמור
                            </button>
                          </div>
                        </div>
                      ) : null}
                      {!hasArbox && isArboxTriggerType(trigger.trigger_type) ? (
                        <p className="text-xs text-zinc-500">
                          {trigger.enabled ? "פעיל" : "מושבת"}
                        </p>
                      ) : null}
                    </div>
                    {hasArbox || !isArboxTriggerType(trigger.trigger_type) ? (
                      <div className="flex shrink-0 items-center gap-2 self-end sm:self-start">
                        <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-zinc-300 text-[#7133da] focus:ring-[#7133da]"
                            checked={trigger.enabled}
                            disabled={triggerTogglingId === trigger.id}
                            onChange={(e) => void onToggleTrigger(trigger, e.target.checked)}
                          />
                          פעיל
                        </label>
                        <button
                          type="button"
                          onClick={() => startEditTrigger(trigger)}
                          className="inline-flex items-center gap-1 rounded-xl border border-zinc-200 px-2.5 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
                          aria-label="ערוך טריגר"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          עריכה
                        </button>
                        <button
                          type="button"
                          disabled={triggerDeletingId === trigger.id}
                          onClick={() => void onDeleteTrigger(trigger.id)}
                          className="inline-flex items-center gap-1 rounded-xl border border-red-200 px-2.5 py-1.5 text-xs text-red-700 hover:bg-red-50 disabled:opacity-60"
                          aria-label="מחק טריגר"
                        >
                          {triggerDeletingId === trigger.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                          מחק
                        </button>
                      </div>
                    ) : null}
                  </div>
                </li>
              ))}

              {creatableCatalogEntries.map((entry) => {
                const type = entry.type as TriggerType;
                const open = createFormOpenFor === type;
                const alreadyHas = filteredTriggers.some(
                  (t) => t.trigger_type === type || (type === "incoming_lead" && isIncomingLeadType(t.trigger_type))
                );
                return (
                  <li
                    key={`create-${entry.type}`}
                    ref={open ? addTriggerSectionRef : undefined}
                    id={open ? "add-trigger" : undefined}
                    className="scroll-mt-28 rounded-xl border border-[#7133da]/25 bg-[#7133da]/5 px-3 py-3 sm:px-4 text-right"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 space-y-1">
                        <p className="font-medium text-zinc-900">{entry.labelHe}</p>
                        <p className="text-xs text-zinc-500">{entry.sendHintHe}</p>
                      </div>
                      {!open ? (
                        <button
                          type="button"
                          onClick={() => startCreateTrigger(type)}
                          className="inline-flex shrink-0 items-center rounded-xl bg-[#7133da] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#5f28c0]"
                        >
                          {alreadyHas ? "צור עוד" : "צור טריגר"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={closeCreateTriggerForm}
                          className="inline-flex shrink-0 items-center rounded-xl border border-zinc-200 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
                        >
                          ביטול
                        </button>
                      )}
                    </div>

                    {open ? (
                      <form className="mt-3 space-y-4 border-t border-zinc-200/80 pt-3" onSubmit={(e) => void onCreateTrigger(e)}>
                        {showNewProductFilter ? (
                          <div className="space-y-2">
                            <label className="text-sm font-medium text-zinc-800">
                              {newTriggerType === "trial_reminder"
                                ? "מוצרי ניסיון"
                                : "סינון מוצרים (אופציונלי)"}
                            </label>
                            <p className="text-xs text-zinc-500">
                              {newTriggerType === "trial_reminder"
                                ? "חייבים לבחור מוצרי ניסיון (אותם מוצרים כמו באי־הגעה לניסיון), או להגדיר אותם בהגדרות. בלי זה התזכורת לא תישלח."
                                : "השאירו ריק כדי להחיל על כל המוצרים. נטען מארבוקס אם מוגדר CRM."}
                            </p>
                            {arboxMembershipTypesLoading ? (
                              <p className="flex items-center gap-2 text-xs text-zinc-500">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                טוען מוצרים מארבוקס…
                              </p>
                            ) : arboxMembershipTypesError ? (
                              <div className="space-y-2">
                                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
                                  לא נטענו מוצרים מארבוקס ({arboxMembershipTypesError}). TODO: הזינו מזהי
                                  membership_type מופרדים בפסיק:
                                </p>
                                <input
                                  value={newProductFilter.join(",")}
                                  onChange={(e) => {
                                    const ids = e.target.value
                                      .split(",")
                                      .map((s) => Number(s.trim()))
                                      .filter((n) => Number.isFinite(n) && n > 0);
                                    setNewProductFilter([...new Set(ids)].sort((a, b) => a - b));
                                  }}
                                  dir="ltr"
                                  placeholder="123, 456"
                                  className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-left"
                                />
                              </div>
                            ) : arboxMembershipTypes.length === 0 ? (
                              <p className="text-xs text-zinc-500">
                                {newTriggerType === "trial_reminder"
                                  ? "לא נמצאו מוצרים — התזכורת לא תישלח עד שיוגדרו מוצרי ניסיון."
                                  : "לא נמצאו מוצרים — יוחל על כל המוצרים."}
                              </p>
                            ) : (
                              <div className="space-y-2">
                                <input
                                  type="search"
                                  value={newProductFilterQuery}
                                  onChange={(e) => setNewProductFilterQuery(e.target.value)}
                                  placeholder="סינון לפי מילים…"
                                  aria-label="סינון מוצרים לפי מילים"
                                  autoComplete="off"
                                  className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
                                />
                                {visibleNewProductFilterTypes.length === 0 ? (
                                  <p className="text-xs text-zinc-500">אין מוצרים שמתאימים לסינון.</p>
                                ) : (
                                  <ul className="max-h-48 space-y-2 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-2">
                                    {visibleNewProductFilterTypes.map((row) => {
                                      const id = row.membership_type_id;
                                      const checked = newProductFilter.includes(id);
                                      const inputId = `trigger-product-${type}-${id}`;
                                      return (
                                        <li key={id}>
                                          <label
                                            htmlFor={inputId}
                                            className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 hover:bg-zinc-50"
                                          >
                                            <input
                                              id={inputId}
                                              type="checkbox"
                                              className="mt-0.5 shrink-0"
                                              checked={checked}
                                              onChange={() => toggleNewProductFilter(id)}
                                            />
                                            <span className="text-xs leading-snug text-zinc-800" dir="ltr">
                                              {`${id} - ${row.membership_type_name}`}
                                            </span>
                                          </label>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                )}
                              </div>
                            )}
                          </div>
                        ) : null}

                        {showNewItemTypeFilter ? (
                          <div className="space-y-2">
                            <label className="text-sm font-medium text-zinc-800">
                              סוג רכישה (אופציונלי)
                            </label>
                            <p className="text-xs text-zinc-500">
                              השאירו ריק לכל הסוגים. בחרו מנוי / כרטיסייה / שירות / ניסיון כדי לפצל
                              טמפלייטים בלי לרשום מזהי מוצר.
                            </p>
                            <ul className="space-y-2 rounded-xl border border-zinc-200 bg-white p-2">
                              {PURCHASE_ITEM_TYPE_VALUES.map((value) => {
                                const inputId = `trigger-item-type-${type}-${value}`;
                                const checked = newItemTypeFilter.includes(value);
                                return (
                                  <li key={value}>
                                    <label
                                      htmlFor={inputId}
                                      className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 hover:bg-zinc-50"
                                    >
                                      <input
                                        id={inputId}
                                        type="checkbox"
                                        className="shrink-0"
                                        checked={checked}
                                        onChange={() => toggleNewItemTypeFilter(value)}
                                      />
                                      <span className="text-xs text-zinc-800">
                                        {PURCHASE_ITEM_TYPE_LABELS_HE[value]}
                                        <span className="text-zinc-400" dir="ltr">
                                          {" "}
                                          ({value})
                                        </span>
                                      </span>
                                    </label>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        ) : null}

                        {isNewImmediateDelay ? (
                          <p className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
                            נשלח מיד עם האירוע — אין השהייה של ימים.
                          </p>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1.5">
                              <label className="text-sm font-medium text-zinc-800">
                                {isAttendanceGapTriggerType(newTriggerType)
                                  ? "ימי היעדרות"
                                  : "ימים"}
                              </label>
                              <input
                                type="number"
                                min={newDelayDaysMin}
                                step={1}
                                value={newDelayDays}
                                onChange={(e) =>
                                  setNewDelayDays(
                                    Math.max(
                                      newDelayDaysMin,
                                      Number(e.target.value) || newDelayDaysMin
                                    )
                                  )
                                }
                                className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
                              />
                              {newTriggerType === "no_response" ? (
                                <p className="text-xs text-zinc-500">
                                  מינימום 2 ימי שתיקה (מתחת ל־24ש׳ מטופל בפולואפ סשן).
                                </p>
                              ) : isAttendanceGapTriggerType(newTriggerType) ? (
                                <p className="text-xs text-zinc-500">
                                  כמה ימים בלי נוכחות אמיתית (check-in) לפני שליחה — מומלץ 7 / 14 /
                                  21. נשלח ביום הזיהוי.
                                </p>
                              ) : isBirthdayFamilyTriggerType(newTriggerType) ? (
                                <p className="text-xs text-zinc-500">
                                  0 = ביום ההולדת. לברכה לפני — בחרו «לפני» ומספר ימים (למשל 14).
                                </p>
                              ) : null}
                            </div>
                            {!hideNewDelayDirection ? (
                              <div className="space-y-1.5">
                                <label className="text-sm font-medium text-zinc-800">כיוון</label>
                                <select
                                  value={newDelayDirection}
                                  onChange={(e) => setNewDelayDirection(e.target.value as DelayDirection)}
                                  className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
                                >
                                  {isBirthdayFamilyTriggerType(newTriggerType) ? (
                                    <>
                                      <option value="before">לפני יום ההולדת</option>
                                      <option value="after">אחרי יום ההולדת</option>
                                    </>
                                  ) : (
                                    <>
                                      <option value="before">לפני פקיעת התוקף</option>
                                      <option value="after">אחרי פקיעת התוקף</option>
                                    </>
                                  )}
                                </select>
                              </div>
                            ) : null}
                          </div>
                        )}

                        <div className="space-y-2">
                          <p className="text-sm font-medium text-zinc-800">טמפלייט</p>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setNewTemplateMode("create_new");
                                applyInlinePresetForType(newTriggerType);
                              }}
                              className={`rounded-xl px-3 py-1.5 text-xs font-medium border ${
                                newTemplateMode === "create_new"
                                  ? "border-[#7133da] bg-[#7133da] text-white"
                                  : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                              }`}
                            >
                              צור חדש (מטא)
                            </button>
                            <button
                              type="button"
                              onClick={() => setNewTemplateMode("use_existing")}
                              className={`rounded-xl px-3 py-1.5 text-xs font-medium border ${
                                newTemplateMode === "use_existing"
                                  ? "border-[#7133da] bg-[#7133da] text-white"
                                  : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                              }`}
                            >
                              טמפלייט קיים
                            </button>
                          </div>

                          {newTemplateMode === "create_new" ? (
                            <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-3">
                              {!hasWaba ? (
                                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
                                  אין WhatsApp מחובר — חברו WABA לפני יצירת טמפלייט חדש, או בחרו
                                  «טמפלייט קיים».
                                </p>
                              ) : null}
                              <TemplateDraftFields
                                value={inlineDraft}
                                onChange={setInlineDraft}
                                bodyHint={`אפשר להשתמש ב־{{1}}, {{2}} וכו׳. ${presetVarHint(newTriggerType)}.`}
                              />
                              <p className="text-xs text-zinc-500 leading-relaxed">
                                יישלח לאישור Meta. הטריגר יופעל אוטומטית אחרי האישור (בלי צורך
                                לחזור לכאן). עד אז הקרון לא שולח.
                              </p>
                            </div>
                          ) : (
                            <div className="space-y-1.5">
                              <label className="text-sm font-medium text-zinc-800 sr-only">
                                טמפלייט מאושר
                              </label>
                              <select
                                value={newTemplateName}
                                onChange={(e) => setNewTemplateName(e.target.value)}
                                className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-right"
                                dir="rtl"
                                style={{ textAlignLast: "right" }}
                              >
                                <option value="">— ללא טמפלייט —</option>
                                {approvedSelectableTemplates.map((t) => (
                                  <option key={t.name} value={t.name}>
                                    {t.name}
                                  </option>
                                ))}
                              </select>
                              {approvedSelectableTemplates.length === 0 ? (
                                <p className="text-xs text-zinc-500">
                                  אין טמפלייט מאושר עדיין — צרו חדש במסלול «צור חדש».
                                </p>
                              ) : null}
                            </div>
                          )}
                        </div>

                        <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-zinc-300 text-[#7133da] focus:ring-[#7133da]"
                            checked={newTriggerEnabled}
                            onChange={(e) => setNewTriggerEnabled(e.target.checked)}
                          />
                          הפעל מיד לאחר הוספה
                        </label>
                        {newTemplateMode === "create_new" && newTriggerEnabled ? (
                          <p className="text-xs text-zinc-500 -mt-2">
                            השליחה תתחיל אוטומטית אחרי ש־Meta יאשר את הטמפלייט.
                          </p>
                        ) : null}

                        <div className="flex justify-end">
                          <button
                            type="submit"
                            disabled={
                              triggerSaving ||
                              (newTemplateMode === "create_new" && !hasWaba)
                            }
                            className="inline-flex items-center gap-1.5 rounded-xl bg-[#7133da] px-4 py-2 text-sm font-medium text-white hover:bg-[#5f28c0] disabled:opacity-60"
                          >
                            {triggerSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                            {newTemplateMode === "create_new"
                              ? "צור טמפלייט + טריגר"
                              : "צור טריגר"}
                          </button>
                        </div>
                      </form>
                    ) : null}
                  </li>
                );
              })}

              {plannedCatalogEntries.map((e) => (
                <li
                  key={`planned-${e.type}`}
                  className="rounded-xl border border-dashed border-zinc-200 bg-zinc-50/80 px-3 py-3 text-right"
                >
                  <p className="font-medium text-zinc-700">{e.labelHe}</p>
                  <p className="mt-1 text-xs text-zinc-500">בקרוב</p>
                </li>
              ))}
            </ul>

            {enabledIncomingLead && axisAudience === "leads" ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 space-y-3 text-right">
                <h3 className="text-sm font-semibold text-zinc-900">Webhook — ליד מאתר/קמפיין</h3>
                <p className="text-xs leading-relaxed text-zinc-700">
                  לאתר עם טופס (Elementor): הדביקו את ה-URL ב-Actions → Webhook.
                </p>
                <p className="text-xs leading-relaxed text-zinc-700">
                  לקמפיין פייסבוק/גוגל: חברו דרך Zapier/Make — &apos;ליד חדש → POST ל-URL הזה&apos;.
                </p>
                <p className="text-xs leading-relaxed text-zinc-700">
                  שדות:{" "}
                  <span dir="ltr" className="font-mono">
                    full_name
                  </span>
                  ,{" "}
                  <span dir="ltr" className="font-mono">
                    phone
                  </span>
                  .
                </p>
                <CopyBlock label="Webhook URL" text={incomingLeadWebhookUrl} />
                {!leadsWebhookSecret ? (
                  <p className="text-xs text-amber-800">
                    חסר טוקן לעסק — פנו לתמיכה לפני חיבור הטופס או האוטומציה.
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}

        {axisActivation === "manual" && axisAudience !== "staff" ? (
          <ul className="space-y-3">
            {axisCatalogEntries.length === 0 ? (
              <li className="text-sm text-zinc-500 text-right">אין קמפיינים בקהל הזה עדיין.</li>
            ) : (
              axisCatalogEntries.map((entry) => {
                const manualType = "manualAudienceType" in entry ? entry.manualAudienceType : undefined;
                const open = activeManualCampaign === entry.type;
                return (
                  <li
                    key={entry.type}
                    className="rounded-xl border border-zinc-200 bg-white px-3 py-3 sm:px-4 space-y-3"
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-right">
                      <div>
                        <p className="font-medium text-zinc-900">{entry.labelHe}</p>
                        <p className="text-xs text-zinc-500">{entry.sendHintHe}</p>
                      </div>
                      {entry.implemented && manualType ? (
                        <button
                          type="button"
                          onClick={() =>
                            setActiveManualCampaign(open ? null : entry.type)
                          }
                          className="inline-flex items-center rounded-xl bg-[#7133da] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#5f28c0]"
                        >
                          {open ? "סגור" : "שלח קמפיין"}
                        </button>
                      ) : (
                        <span className="inline-flex rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs text-zinc-600">
                          בקרוב
                        </span>
                      )}
                    </div>
                    {open && manualType ? (
                      <CampaignSendPanel
                        slug={slug}
                        audienceType={manualType}
                        templates={marketingTemplates}
                        onClose={() => setActiveManualCampaign(null)}
                      />
                    ) : null}
                  </li>
                );
              })
            )}
          </ul>
        ) : null}
      </section>

      {showCreate && (
        <ModalShell
          title={isEditing ? "עריכת טמפלייט" : "צור טמפלייט חדש"}
          onClose={() => {
            if (creating) return;
            setShowCreate(false);
            resetCreateForm();
          }}
          widthClass="max-w-xl"
        >
          <form className="space-y-4" onSubmit={(e) => void onCreate(e)}>
            {isEditing ? (
              <p className="text-xs leading-relaxed text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                שם ושפה לא ניתנים לשינוי במטא. אחרי שמירה הטמפלייט חוזר לאישור, ועד אז הוא לא יישלח
                ללקוחות (כולל טריגרים שמחוברים אליו).
              </p>
            ) : (
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-zinc-800">מטרה</label>
              <select
                value={purposeTrigger}
                onChange={(e) => applyPurposePreset((e.target.value || "") as TriggerType | "")}
                className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm"
              >
                <option value="">בחירה ידנית</option>
                {purposeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-zinc-500">
                בחירה ממלאת שם, קטגוריה, גוף וכפתור. אפשר לערוך אחרי הבחירה — הבחירה עצמה לא נשמרת במטא.
              </p>
            </div>
            )}

            <TemplateDraftFields
              value={{ name, category, language, body, header, footer, buttons }}
              onChange={(next) => {
                setName(next.name);
                setCategory(next.category);
                setLanguage(next.language);
                setBody(next.body);
                setHeader(next.header);
                setFooter(next.footer);
                setButtons(next.buttons);
              }}
              nameDisabled={isEditing}
              languageDisabled={isEditing}
              categoryLocked={categoryLocked}
              bodyHint={
                purposeTrigger
                  ? `אפשר להשתמש ב־{{1}}, {{2}} וכו׳. ${presetVarHint(purposeTrigger)}.`
                  : undefined
              }
            />

            {createSuccess && (
              <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                {isEditing ? "העריכה נשלחה לאישור מטא" : "נשלח לאישור מטא"}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={creating}
                onClick={() => {
                  setShowCreate(false);
                  resetCreateForm();
                }}
                className="rounded-xl border border-zinc-200 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
              >
                ביטול
              </button>
              <button
                type="submit"
                disabled={!canSubmitCreate}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#7133da] px-4 py-2 text-sm font-medium text-white hover:bg-[#5f28c0] disabled:opacity-60"
              >
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {isEditing ? "שמור ושלח לאישור מטא" : "שלח לאישור מטא"}
              </button>
            </div>
          </form>
        </ModalShell>
      )}

      {connectPrompt ? (
        <ModalShell
          title="כעת נחבר את הטמפלייט לטריגר המתאים!"
          onClose={closeConnectPrompt}
          widthClass="max-w-md"
        >
          <div className="space-y-5 text-right">
            <p className="text-sm leading-relaxed text-zinc-600">
              טריגר הוא הפעולה ששולחת פקודה לשלוח את הטמפלייט
            </p>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeConnectPrompt}
                className="rounded-xl border border-zinc-200 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
              >
                לא עכשיו
              </button>
              <button
                type="button"
                onClick={onConnectToTrigger}
                className="rounded-xl bg-[#7133da] px-4 py-2 text-sm font-medium text-white hover:bg-[#5f28c0]"
              >
                חבר לטריגר
              </button>
            </div>
          </div>
        </ModalShell>
      ) : null}

      {showAutomation && (
        <ModalShell
          title="חיבור לאוטומציה"
          onClose={() => setShowAutomation(false)}
          widthClass="max-w-2xl"
        >
          <div className="space-y-5 text-sm text-zinc-700">
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 text-xs leading-relaxed">
              הסוד הזה מזהה את העסק שלכם — אל תשתפו אותו בפומבי.
            </p>

            <p className="leading-relaxed">
              כדי שזואי תשלח טמפלייט פתיחה לליד חדש, הגדירו קודם טמפלייט מאושר כ־«טמפלייט הפתיחה
              ללידים» ברשימה למעלה, ואז חברו את מקור הלידים לאחד מהאופציות הבאות.
            </p>

            <section className="space-y-3 rounded-2xl border border-zinc-100 p-4">
              <h3 className="font-semibold text-zinc-900">שיטה 1 — Zapier (ללא קוד)</h3>
              <ol className="list-decimal list-inside space-y-1.5 text-sm leading-relaxed">
                <li>צרו Zap חדש</li>
                <li>Trigger = מקור הלידים שלכם (טופס / גיליון / CRM)</li>
                <li>Action = Webhooks by Zapier → POST</li>
                <li>מלאו את הפרטים הבאים:</li>
              </ol>
              <CopyBlock label="URL" text={incomingUrl} />
              <CopyBlock
                label="Header: x-leads-secret"
                text={leadsWebhookSecret || "(חסר סוד לעסק — פנו לתמיכה)"}
              />
              <CopyBlock label="Body (JSON)" text={zapierBodyExample} />
              <p className="text-xs text-zinc-500">
                אין צורך ב־business_slug — הטוקן מזהה את העסק אוטומטית.
              </p>
            </section>

            <section className="space-y-3 rounded-2xl border border-zinc-100 p-4">
              <h3 className="font-semibold text-zinc-900">שיטה 2 — קוד / curl</h3>
              <p className="text-xs text-zinc-500 leading-relaxed">
                מספר הטלפון מנורמל אוטומטית לפורמט ישראלי. חייבים טמפלייט פתיחה מאושר בעסק.
              </p>
              <CopyBlock label="curl" text={curlExample} />
            </section>
          </div>
        </ModalShell>
      )}
    </div>
  );
}
