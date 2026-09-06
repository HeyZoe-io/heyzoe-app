"use client";

/**
 * Shared Meta template draft fields — used by the standalone creator modal and the
 * inline "create new" path inside the trigger card so the two UIs cannot diverge.
 */

export type TemplateButtonDraft = {
  kind: "QUICK_REPLY" | "URL";
  text: string;
  url: string;
};

export type TemplateDraftValue = {
  name: string;
  category: "MARKETING" | "UTILITY";
  language: string;
  body: string;
  header: string;
  footer: string;
  buttons: TemplateButtonDraft[];
};

export const EMPTY_TEMPLATE_BUTTONS: TemplateButtonDraft[] = [
  { kind: "QUICK_REPLY", text: "", url: "" },
];

export const EMPTY_TEMPLATE_DRAFT: TemplateDraftValue = {
  name: "",
  category: "MARKETING",
  language: "he",
  body: "",
  header: "",
  footer: "",
  buttons: EMPTY_TEMPLATE_BUTTONS,
};

const FIELD_CLASS =
  "w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 caret-zinc-900 placeholder:text-zinc-400 placeholder:opacity-100 [-webkit-text-fill-color:#18181b] placeholder:[-webkit-text-fill-color:#a1a1aa]";

export const TEMPLATE_NAME_RE = /^[a-z0-9_]+$/;

export function isTemplateDraftNameValid(name: string): boolean {
  return !name || TEMPLATE_NAME_RE.test(name);
}

export function TemplateDraftFields({
  value,
  onChange,
  nameDisabled = false,
  languageDisabled = false,
  categoryLocked = false,
  nameRequired = true,
  bodyRequired = true,
  bodyHint,
  nameHint,
}: {
  value: TemplateDraftValue;
  onChange: (next: TemplateDraftValue) => void;
  nameDisabled?: boolean;
  languageDisabled?: boolean;
  categoryLocked?: boolean;
  nameRequired?: boolean;
  bodyRequired?: boolean;
  bodyHint?: string;
  nameHint?: string;
}) {
  const nameValid = isTemplateDraftNameValid(value.name);

  function patch(partial: Partial<TemplateDraftValue>) {
    onChange({ ...value, ...partial });
  }

  function setButtons(updater: (prev: TemplateButtonDraft[]) => TemplateButtonDraft[]) {
    patch({ buttons: updater(value.buttons) });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-zinc-800">שם הטמפלייט</label>
        <input
          value={value.name}
          onChange={(e) => {
            const next = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "");
            patch({ name: next });
          }}
          className={`${FIELD_CLASS} text-left disabled:bg-zinc-50 disabled:text-zinc-500`}
          dir="ltr"
          placeholder="lead_welcome"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          required={nameRequired}
          disabled={nameDisabled}
        />
        <p className="text-xs text-zinc-500">
          {nameHint ??
            (nameDisabled
              ? "השם נשאר כמו במטא — אי אפשר לשנות אותו בעריכה."
              : "שם באנגלית בלבד, אותיות קטנות, מספרים וקו תחתון (_). ללא רווחים ועברית.")}
        </p>
        {!nameValid && (
          <p className="text-xs text-red-600">השם יכול לכלול רק a-z, 0-9 ו־_</p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-zinc-800">קטגוריה</label>
          <select
            value={value.category}
            onChange={(e) =>
              patch({ category: e.target.value as "MARKETING" | "UTILITY" })
            }
            disabled={categoryLocked}
            className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm disabled:bg-zinc-50 disabled:text-zinc-500"
          >
            <option value="MARKETING">MARKETING</option>
            <option value="UTILITY">UTILITY</option>
          </select>
          {categoryLocked ? (
            <p className="text-xs text-zinc-500">לא ניתן לשנות קטגוריה של טמפלייט שכבר אושר.</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-zinc-800">שפה</label>
          <select
            value={value.language}
            onChange={(e) => patch({ language: e.target.value })}
            disabled={languageDisabled}
            className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm disabled:bg-zinc-50 disabled:text-zinc-500"
          >
            <option value="he">he</option>
            <option value="en">en</option>
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-zinc-800">גוף ההודעה (חובה)</label>
        <textarea
          value={value.body}
          onChange={(e) => patch({ body: e.target.value })}
          rows={4}
          required={bodyRequired}
          className={FIELD_CLASS}
          placeholder={"היי {{1}}, תודה שהשארת פרטים — נשמח לחזור אליך!"}
        />
        <p className="text-xs text-zinc-500">
          {bodyHint ??
            `אפשר להשתמש ב־{{1}}, {{2}} וכו׳. {{1}} הוא בדרך כלל שם פרטי של הליד.`}
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-zinc-800">כותרת (אופציונלי)</label>
        <input
          value={value.header}
          onChange={(e) => patch({ header: e.target.value })}
          className={FIELD_CLASS}
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-zinc-800">פוטר (אופציונלי)</label>
        <input
          value={value.footer}
          onChange={(e) => patch({ footer: e.target.value })}
          className={FIELD_CLASS}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label className="text-sm font-medium text-zinc-800">כפתורים (אופציונלי)</label>
          {value.buttons.length < 2 && (
            <button
              type="button"
              className="text-xs text-[#7133da] hover:underline"
              onClick={() =>
                setButtons((prev) => [...prev, { kind: "QUICK_REPLY", text: "", url: "" }])
              }
            >
              + כפתור
            </button>
          )}
        </div>
        {value.buttons.map((b, idx) => (
          <div key={idx} className="rounded-xl border border-zinc-100 p-3 space-y-2">
            <div className="flex gap-2">
              <select
                value={b.kind}
                onChange={(e) => {
                  const kind = e.target.value as TemplateButtonDraft["kind"];
                  setButtons((prev) =>
                    prev.map((row, i) => (i === idx ? { ...row, kind } : row))
                  );
                }}
                className="rounded-lg border border-zinc-200 px-2 py-1.5 text-xs"
              >
                <option value="QUICK_REPLY">Quick reply</option>
                <option value="URL">URL</option>
              </select>
              <input
                value={b.text}
                onChange={(e) =>
                  setButtons((prev) =>
                    prev.map((row, i) =>
                      i === idx ? { ...row, text: e.target.value } : row
                    )
                  )
                }
                placeholder="טקסט כפתור"
                className="flex-1 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 placeholder:opacity-100 [-webkit-text-fill-color:#18181b] placeholder:[-webkit-text-fill-color:#a1a1aa]"
              />
            </div>
            {b.kind === "URL" && (
              <input
                value={b.url}
                onChange={(e) =>
                  setButtons((prev) =>
                    prev.map((row, i) =>
                      i === idx ? { ...row, url: e.target.value } : row
                    )
                  )
                }
                placeholder="https://"
                dir="ltr"
                className="w-full rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-sm text-left text-zinc-900 placeholder:text-zinc-400 placeholder:opacity-100 [-webkit-text-fill-color:#18181b] placeholder:[-webkit-text-fill-color:#a1a1aa]"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
