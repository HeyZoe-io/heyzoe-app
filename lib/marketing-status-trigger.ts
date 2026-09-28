import {
  isMarketingAdminColumn,
  mapLegacyPipelineToAdminColumn,
  MARKETING_ADMIN_COLUMNS,
  type MarketingAdminColumn,
} from "@/lib/marketing-admin-status";

/** עמודות שאפשר לחבר לטריגר. «הסר» לא נכלל — לא שולחים למי שביקש הסרה. */
export const MARKETING_STATUS_TRIGGER_COLUMNS = MARKETING_ADMIN_COLUMNS.filter(
  (column): column is Exclude<MarketingAdminColumn, "opted_out"> => column !== "opted_out"
);

export type MarketingStatusTriggerColumn = (typeof MARKETING_STATUS_TRIGGER_COLUMNS)[number];

const STATUS_TRIGGER_SET = new Set<string>(MARKETING_STATUS_TRIGGER_COLUMNS);

export function isMarketingStatusTriggerColumn(value: unknown): value is MarketingStatusTriggerColumn {
  return typeof value === "string" && STATUS_TRIGGER_SET.has(value);
}

export function marketingAdminColumnFromStored(value: string | null | undefined): MarketingAdminColumn | null {
  if (isMarketingAdminColumn(value)) return value;
  return mapLegacyPipelineToAdminColumn(value);
}

/**
 * העמודה שאליה הליד נכנס עכשיו.
 * null = אין מעבר (אותה עמודה, הסר, או ערך לא מוכר).
 */
export function marketingStatusEnteredColumn(
  previous: string | null | undefined,
  next: string | null | undefined
): MarketingStatusTriggerColumn | null {
  const nextColumn = marketingAdminColumnFromStored(next);
  if (!nextColumn || !isMarketingStatusTriggerColumn(nextColumn)) return null;
  const previousColumn = marketingAdminColumnFromStored(previous);
  if (previousColumn === nextColumn) return null;
  return nextColumn;
}
