-- Acro by Joe — Arbox CRM ids (dashboard: לינקים → CRM, יוני 2026)
-- location_id: 3068 | lead status: 9865 | Zoe lead source: 119132
update public.businesses
set
  crm_box_id = '3068',
  crm_arbox_status_id = '9865',
  crm_arbox_source_id = '119132'
where lower(slug) = 'acrobyjoe';
