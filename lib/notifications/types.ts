export const NOTIFICATION_SETTING_KEYS = [
  "new_lead",
  "human_requested",
  "bot_paused_waiting",
  "cta_no_signup",
  "lead_registered",
  "daily_summary",
] as const;

export type NotificationSettingKey = (typeof NOTIFICATION_SETTING_KEYS)[number];

export type NotificationSettings = Record<NotificationSettingKey, boolean>;

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  new_lead: true,
  human_requested: true,
  bot_paused_waiting: true,
  cta_no_signup: true,
  lead_registered: true,
  daily_summary: true,
};

export type NotificationSettingRow = NotificationSettings & {
  business_id: number;
  last_daily_summary_at?: string | null;
};
