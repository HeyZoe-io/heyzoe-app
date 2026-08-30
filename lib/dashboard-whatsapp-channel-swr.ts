/** Shared SWR key for dashboard WhatsApp channel + zoe_activated. */
export function dashboardWhatsAppChannelSwrKey(slug: string): string {
  const norm = String(slug ?? "").trim().toLowerCase();
  return `/api/dashboard/whatsapp-channel?slug=${encodeURIComponent(norm)}`;
}

/** Banner + settings toggle share this so turning Zoe on/off updates both immediately. */
export function dashboardZoeActivatedSwrKey(slug: string): string {
  const norm = String(slug ?? "").trim().toLowerCase();
  return `zoe-activated:${norm}`;
}

export type DashboardWhatsAppChannelSwrData = {
  channel: {
    phone_display: string;
    provisioning_status: "pending" | "active" | "failed" | null;
    is_active: boolean;
  } | null;
  zoe_activated?: boolean;
};
