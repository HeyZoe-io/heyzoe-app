/** נשמר ב-DB + נשלח ב-API */
export const NOTIFICATION_SETTING_KEYS = [
  "lead_registered",
  "human_requested",
  "daily_summary",
  "new_lead",
  "cta_no_signup",
  "bot_paused_waiting",
  "lead_registered_email",
  "human_requested_email",
  "daily_summary_email",
] as const;

/** רק מה שמופיע ב-/account/notifications */
export const NOTIFICATION_UI_SETTING_KEYS = [
  "lead_registered",
  "human_requested",
  "daily_summary",
  "lead_registered_email",
  "human_requested_email",
  "daily_summary_email",
] as const;

export type NotificationSettingKey = (typeof NOTIFICATION_SETTING_KEYS)[number];

export type NotificationUiSettingKey = (typeof NOTIFICATION_UI_SETTING_KEYS)[number];

export type OwnerEmailSettingKey =
  | "lead_registered_email"
  | "human_requested_email"
  | "daily_summary_email";

export type NotificationSettings = Record<NotificationSettingKey, boolean>;

/** UI fallback + defaults when no DB row exists */
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  lead_registered: false,
  human_requested: false,
  daily_summary: false,
  new_lead: false,
  cta_no_signup: false,
  bot_paused_waiting: false,
  lead_registered_email: false,
  human_requested_email: false,
  daily_summary_email: false,
};

export const WHATSAPP_NOTIFICATION_SETTING_KEYS = [
  "lead_registered",
  "human_requested",
  "daily_summary",
] as const satisfies readonly NotificationSettingKey[];

/** Written on HEYZOE_OWNER opt-in */
export const OWNER_OPT_IN_NOTIFICATION_SETTINGS: NotificationSettings = {
  ...DEFAULT_NOTIFICATION_SETTINGS,
};

export type NotificationSettingRow = NotificationSettings & {
  business_id: number;
  last_daily_summary_at?: string | null;
};
