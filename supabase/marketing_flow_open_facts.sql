-- עובדות לשאלות פתוחות בפלואו השיווקי (מספר HeyZoe שיווקי). הריצו פעם אחת ב-SQL Editor.
alter table marketing_flow_settings
  add column if not exists open_facts jsonb not null default '[]'::jsonb;

comment on column marketing_flow_settings.open_facts is 'מערך מחרוזות: עובדות שזואי משתמשת בהן אחרי סיום הפלואו (שיחת AI שיווקית)';
