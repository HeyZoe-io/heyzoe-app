/** מזהי Plan Do מ-webhook (leads/incoming, plando-registered). */
export function parsePlandoIdsFromWebhookBody(body: Record<string, unknown>): {
  contactId: string | null;
  recordId: string | null;
} {
  const contactId = String(body.plando_contact_id ?? body.contact_id ?? "").trim();
  const recordId = String(body.plando_record_id ?? body.record_id ?? "").trim();
  const valid = (id: string) => Boolean(id) && id !== "-1";
  return {
    contactId: valid(contactId) ? contactId : null,
    recordId: valid(recordId) ? recordId : null,
  };
}

export function buildPlandoContactPatchFromWebhook(body: Record<string, unknown>): Record<string, string> {
  const { contactId, recordId } = parsePlandoIdsFromWebhookBody(body);
  const patch: Record<string, string> = {};
  if (contactId) patch.plando_contact_id = contactId;
  if (recordId) patch.plando_record_id = recordId;
  return patch;
}
