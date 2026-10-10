/**
 * Creates zoe_knowledge_updates_v1 on the Zoe Admin WABA if it is missing.
 * Does not send the template to anyone.
 *
 *   npx tsx --env-file=.env.local scripts/submit-knowledge-update-template.ts
 */
import { createWabaTemplate, listWabaTemplates } from "@/lib/meta-templates";
import { resolveMarketingWabaId } from "@/lib/marketing-waba";
import { KNOWLEDGE_UPDATE_TEMPLATE, KNOWLEDGE_UPDATE_TEMPLATE_BODY } from "@/lib/knowledge-updates";

async function main(): Promise<void> {
  const wabaId = await resolveMarketingWabaId();
  if (!wabaId) throw new Error("missing_waba");
  const existing = (await listWabaTemplates(wabaId)).find(
    (row) => row.name === KNOWLEDGE_UPDATE_TEMPLATE && row.language === "he"
  );
  if (existing) {
    console.log(JSON.stringify({ name: existing.name, status: existing.status, category: existing.category, created: false }));
    return;
  }
  const created = await createWabaTemplate(wabaId, {
    name: KNOWLEDGE_UPDATE_TEMPLATE,
    category: "UTILITY",
    language: "he",
    components: [
      { type: "BODY", text: KNOWLEDGE_UPDATE_TEMPLATE_BODY },
      { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "מתחילים" }] },
    ],
  });
  console.log(
    JSON.stringify({
      name: KNOWLEDGE_UPDATE_TEMPLATE,
      status: created.status,
      category: created.category ?? "",
      created: true,
    })
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
