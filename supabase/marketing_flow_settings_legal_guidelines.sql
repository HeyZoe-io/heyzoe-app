-- חוקיות והנחיות לזואי שיווק (דשבורד אדמין). הרצה חוזרת בטוחה.
alter table marketing_flow_settings
  add column if not exists marketing_legal_guidelines jsonb not null default '[]'::jsonb;

comment on column marketing_flow_settings.marketing_legal_guidelines is
  'מערך מחרוזות: חוקיות לזואי אחרי הפלואו; ריק = ברירת מחדל מהאפליקציה';
