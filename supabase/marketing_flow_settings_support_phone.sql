-- מספר שירות לקוחות להפניה כשזואי לא יודעת לענות (פלואו שיווקי / טאב שאלות פתוחות).
alter table marketing_flow_settings
  add column if not exists marketing_support_phone text not null default '';

comment on column marketing_flow_settings.marketing_support_phone is 'וואטסאפ/טלפון: הפניה כשאין תשובה בעובדות (מערכת, תנאים, תקלות)';
