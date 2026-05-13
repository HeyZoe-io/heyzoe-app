-- הרחבת marketing_flow_nodes.type לנוד «delay» (השהיה בשניות).
-- הריצו ב-Supabase SQL Editor אם שמירת הפלואו נכשלת עם:
--   violates check constraint "marketing_flow_nodes_type_check"

alter table marketing_flow_nodes
  drop constraint if exists marketing_flow_nodes_type_check;

alter table marketing_flow_nodes
  add constraint marketing_flow_nodes_type_check
  check (type in ('message', 'question', 'media', 'cta', 'followup', 'delay'));
