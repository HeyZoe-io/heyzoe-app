type ProductOfferKind = "trial" | "workshop" | "course";

const TRIAL_PRODUCT_DESC_FOOTER =
  "השיעור עולה {price} ₪ בלבד ונמשך כ-{duration} דקות :) {business_address}. נשלח לך את כל הפרטים לאחר ההרשמה. ניתן גם לשאול כל שאלה פתוחה ואני אענה!";

const WORKSHOP_PRODUCT_DESC_FOOTER =
  "הסדנה עולה {price} ₪ בלבד ונמשכת כ-{duration} דקות :) {business_address}. נשלח לך את כל הפרטים לאחר ההרשמה. ניתן גם לשאול כל שאלה פתוחה ואני אענה!";

const COURSE_PRODUCT_DESC_FOOTER =
  "המחיר הוא מחיר מוזל לשבוע הקרוב על סך {price} שקלים. הקורס נמשך כ-{sessions} מפגשים.\n\n{schedule_phrase}";

const PRODUCT_DESC_FOOTER_MARKERS = [
  TRIAL_PRODUCT_DESC_FOOTER,
  WORKSHOP_PRODUCT_DESC_FOOTER,
  COURSE_PRODUCT_DESC_FOOTER,
  "נשלח לך את כל הפרטים לאחר ההרשמה",
  "מחיר מוזל לשבוע הקרוב על סך {price}",
] as const;

export type ProductDescriptionFillInput = {
  priceText?: string;
  durationText?: string;
  businessAddress?: string;
  sessionsText?: string;
  schedulePhrase?: string;
  offerKind?: ProductOfferKind | string;
};

function normalizeOfferKind(offerKind: string | undefined): ProductOfferKind {
  const k = String(offerKind ?? "trial").trim().toLowerCase();
  if (k === "workshop" || k === "course") return k;
  return "trial";
}

function footerForOfferKind(offerKind: ProductOfferKind): string {
  if (offerKind === "course") return COURSE_PRODUCT_DESC_FOOTER;
  if (offerKind === "workshop") return WORKSHOP_PRODUCT_DESC_FOOTER;
  return TRIAL_PRODUCT_DESC_FOOTER;
}

/** מסיר סיומת ג׳ינרוט קודמת לפני ג׳ינרוט מחדש / שליחה ל-AI. */
export function stripGeneratedProductDescriptionFooter(text: string): string {
  let s = String(text ?? "").trim();
  if (!s) return s;

  for (const marker of PRODUCT_DESC_FOOTER_MARKERS) {
    const idx = s.lastIndexOf(marker);
    if (idx >= 0) {
      s = s.slice(0, idx).trim();
    }
  }

  return s.replace(/\n{3,}/g, "\n\n").trim();
}

/** מוסיף סיומת ברירת מחדל אחרי ג׳ינרוט AI — רק בלחיצה «ג׳נרט תיאור». */
export function appendGeneratedProductDescriptionFooter(description: string, offerKindRaw?: string): string {
  const offerKind = normalizeOfferKind(offerKindRaw);
  const base = stripGeneratedProductDescriptionFooter(description);
  const footer = footerForOfferKind(offerKind);
  if (!base) return footer;
  if (base.includes(footer)) return base;
  return `${base}\n\n${footer}`;
}

function fillBusinessAddressPlaceholder(text: string, address: string): string {
  const a = address.trim();
  if (a) return text.replaceAll("{business_address}", a);
  return text
    .replaceAll(" :) {business_address}.", " :)")
    .replaceAll(" {business_address}.", ".")
    .replaceAll("{business_address}", "")
    .replace(/\.\s*\./g, ".");
}

/** ממלא placeholders בתיאור מוצר לפני שליחה ללקוח. */
export function fillProductDescriptionTemplate(text: string, fill: ProductDescriptionFillInput): string {
  let s = String(text ?? "").trim();
  if (!s) return s;

  const price = String(fill.priceText ?? "").trim() || "...";
  const duration = String(fill.durationText ?? "").trim() || "...";
  const sessions = String(fill.sessionsText ?? "").trim() || "...";
  const schedulePhrase = String(fill.schedulePhrase ?? "").trim();

  s = s.replaceAll("{priceText}", price).replaceAll("{price}", price);
  s = s.replaceAll("{durationText}", duration).replaceAll("{duration}", duration);
  s = s.replaceAll("{sessions}", sessions);
  s = fillBusinessAddressPlaceholder(s, String(fill.businessAddress ?? ""));

  if (schedulePhrase) {
    s = s.replaceAll("{schedule_phrase}", schedulePhrase).replaceAll("{schedulePhrase}", schedulePhrase);
  } else {
    s = s
      .replace(/\n*\{schedule_phrase\}\n*/g, "\n")
      .replace(/\n*\{schedulePhrase\}\n*/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  return s;
}
