import { redirectLegacyAccountFromHeaders } from "@/lib/account/legacy-account-redirect";

export const dynamic = "force-dynamic";

/** Redirect /account/* → /[slug]/account/* (legacy URLs). */
export default async function LegacyAccountLayout() {
  await redirectLegacyAccountFromHeaders();
}
