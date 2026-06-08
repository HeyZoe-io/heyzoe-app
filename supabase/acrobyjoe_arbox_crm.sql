-- Acro by Joe — Arbox CRM ids (location / source / status)
update public.businesses
set
  crm_box_id = '3068',
  crm_arbox_source_id = '26044',
  crm_arbox_status_id = '15400'
where lower(slug) = 'acrobyjoe';
