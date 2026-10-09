import { lookupArboxUserByPhone } from "@/lib/crm/adapters/arbox";

/**
 * Arbox full name for a queued template. One searchUser per business+phone per process.
 * A miss is cached too, so a tick does not retry the same phone.
 * IO at 10x: one Arbox call per queued recipient that has no stored name. New queue
 * rows store the report name and skip this call.
 */
const cache = new Map<string, string | null>();

export async function arboxFullNameForPhone(input: {
  businessId: number;
  apiKey: string;
  boxId?: string | null;
  phone: string;
}): Promise<string | null> {
  const apiKey = String(input.apiKey ?? "").trim();
  const digits = String(input.phone ?? "").replace(/\D/g, "");
  if (!apiKey || digits.length < 9) return null;
  const key = `${input.businessId}:${digits.slice(-9)}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  const locationId = Number.parseInt(String(input.boxId ?? "").trim(), 10);
  try {
    const hit = await lookupArboxUserByPhone({
      apiKey,
      phone: input.phone,
      ...(Number.isFinite(locationId) && locationId > 0 ? { locationId } : {}),
    });
    const name = String(hit.fullName ?? "").trim() || null;
    cache.set(key, name);
    return name;
  } catch (e) {
    console.error("[arbox-member-name] searchUser threw", e instanceof Error ? e.message : e);
    cache.set(key, null);
    return null;
  }
}
