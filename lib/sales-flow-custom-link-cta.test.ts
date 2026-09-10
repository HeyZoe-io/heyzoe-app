import assert from "node:assert/strict";
import {
  defaultSalesFlowConfig,
  getEffectiveSalesFlowCtaButtons,
  isCustomLinkCtaEnabled,
  parseSalesFlowFromSocial,
  serializeSalesFlowConfig,
  upsertCustomLinkCtaButton,
} from "@/lib/sales-flow";

const emptyEff = {
  trialRegistered: false as const,
  allowTrialCta: true,
  consumedNonTrialKinds: new Set<string>(),
};

const parsedEmpty = parseSalesFlowFromSocial({
  cta_buttons: defaultSalesFlowConfig([]).cta_buttons,
});
assert.equal(parsedEmpty?.cta_buttons.some((b) => b.kind === "custom_link"), false);

const withCustom = parseSalesFlowFromSocial({
  cta_buttons: [
    { id: "cta-trial", label: "הרשמה לשיעור ניסיון", kind: "trial" },
    { id: "cta-schedule", label: "צפייה במערכת השעות", kind: "schedule" },
    { id: "cta-memberships", label: "מחירי מנויים", kind: "memberships" },
    {
      id: "cta-custom-link",
      label: "שני שיעורי היכרות",
      kind: "custom_link",
      custom_cta_url: "https://example.com/two-classes",
    },
  ],
});
assert.ok(parsedEmpty);
assert.ok(withCustom);
const custom = withCustom!.cta_buttons.find((b) => b.kind === "custom_link");
assert.equal(custom?.label, "שני שיעורי היכרות");
assert.equal(custom?.custom_cta_url, "https://example.com/two-classes");
assert.equal(isCustomLinkCtaEnabled(custom!), true);

const lockedKinds = withCustom!.cta_buttons.filter((b) => b.kind !== "custom_link").map((b) => b.kind);
assert.deepEqual(lockedKinds, ["trial", "schedule", "memberships"]);

const hidden = getEffectiveSalesFlowCtaButtons(parsedEmpty!.cta_buttons, emptyEff);
assert.equal(hidden.some((b) => b.kind === "custom_link"), false);

const shown = getEffectiveSalesFlowCtaButtons(withCustom!.cta_buttons, emptyEff);
assert.deepEqual(
  shown.map((b) => b.kind),
  ["trial", "custom_link", "schedule", "memberships"]
);

const noUrl = parseSalesFlowFromSocial({
  cta_buttons: [
    ...defaultSalesFlowConfig([]).cta_buttons,
    { id: "cta-custom-link", label: "שני שיעורי היכרות", kind: "custom_link", custom_cta_url: "" },
  ],
});
assert.equal(
  getEffectiveSalesFlowCtaButtons(noUrl!.cta_buttons, emptyEff).some((b) => b.kind === "custom_link"),
  false
);

const upserted = upsertCustomLinkCtaButton(defaultSalesFlowConfig([]).cta_buttons, {
  label: "שני שיעורי היכרות",
  custom_cta_url: "https://apex.example/intro-2",
});
const roundTrip = parseSalesFlowFromSocial(serializeSalesFlowConfig({ ...defaultSalesFlowConfig([]), cta_buttons: upserted }));
assert.equal(roundTrip?.cta_buttons.find((b) => b.kind === "custom_link")?.custom_cta_url, "https://apex.example/intro-2");

// בזמן הקלדה: רווחים בתווית (כולל רווח בסוף) נשמרים — לא עוברים trim מוקדם
const typing = upsertCustomLinkCtaButton(defaultSalesFlowConfig([]).cta_buttons, {
  label: "שני שיעורי ",
});
assert.equal(typing.find((b) => b.kind === "custom_link")?.label, "שני שיעורי ");
const typingMore = upsertCustomLinkCtaButton(typing, { label: "שני שיעורי היכרות" });
assert.equal(typingMore.find((b) => b.kind === "custom_link")?.label, "שני שיעורי היכרות");

// אבל השמירה (serialize) עדיין מנרמלת ומורידה רווחים בקצוות
const serializedTyping = serializeSalesFlowConfig({
  ...defaultSalesFlowConfig([]),
  cta_buttons: typing,
});
const serializedCustom = (serializedTyping.cta_buttons as Array<{ kind?: string; label?: string }>).find(
  (b) => b.kind === "custom_link"
);
assert.equal(serializedCustom?.label, "שני שיעורי");

console.log("sales-flow-custom-link-cta: assertions passed");
