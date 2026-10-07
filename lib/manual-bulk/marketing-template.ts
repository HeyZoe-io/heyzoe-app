export function isApprovedMarketingTemplate(row: {
  status?: unknown;
  category?: unknown;
  disabled?: unknown;
  name?: unknown;
}): boolean {
  if (String(row.name ?? "").trim() === "") return false;
  if (row.disabled === true) return false;
  if (String(row.status ?? "").trim().toUpperCase() !== "APPROVED") return false;
  return String(row.category ?? "").trim().toUpperCase() === "MARKETING";
}
