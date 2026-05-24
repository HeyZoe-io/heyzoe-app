-- שאלת שאלה אחרונה שנענתה — לניתוב מחדש בלחיצה על כפתור אחר (שאלה אחת אחורה)
alter table public.marketing_flow_sessions
  add column if not exists last_question_node_id uuid null references marketing_flow_nodes(id) on delete set null;

comment on column public.marketing_flow_sessions.last_question_node_id is
  'נוד שאלה אחרון שהליד ענה עליו — לניתוב מחדש מכפתור אחר לפני מעבר ל-AI';
