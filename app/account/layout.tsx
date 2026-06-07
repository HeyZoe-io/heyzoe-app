import { redirectLegacyAccountFromHeaders } from "@/lib/account/legacy-account-redirect";

/** Redirect /account/* → /[slug]/account/* (legacy URLs). */
export default async function LegacyAccountLayout() {
  await redirectLegacyAccountFromHeaders();
}
