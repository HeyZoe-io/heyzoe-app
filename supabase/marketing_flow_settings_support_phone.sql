-- מספר שירות לקוחות להפניה כשזואי לא יודעת לענות (פלואו שיווקי / טאב שאלות פתוחות).
alter table marketing_flow_settings
  add column if not exists marketing_support_phone text not null default '';

comment on column marketing_flow_settings.marketing_support_phone is 'מספר וואטסאפ לשירות (ספרות): לבניית wa.me עם טקסט מצורף — לא להצגה גולמית לליד';
