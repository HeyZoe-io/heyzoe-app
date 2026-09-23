import assert from "node:assert/strict";
import { approvedUtilityQuotaTemplateName } from "@/lib/quota-alert-template";
import { shouldSuppressLeadTemplate } from "@/lib/wa-marketing-opt-out";

assert.equal(
  approvedUtilityQuotaTemplateName("quota_warning_80", { status: "APPROVED", category: "UTILITY" }),
  "quota_warning_80_util"
);
assert.equal(
  approvedUtilityQuotaTemplateName("quota_limit_reached", { status: "APPROVED", category: "UTILITY" }),
  "quota_limit_reached_util"
);
assert.equal(
  approvedUtilityQuotaTemplateName("quota_warning_80", { status: "PENDING", category: "UTILITY" }),
  "quota_warning_80"
);
assert.equal(
  approvedUtilityQuotaTemplateName("quota_warning_80", { status: "APPROVED", category: "MARKETING" }),
  "quota_warning_80"
);
assert.equal(
  approvedUtilityQuotaTemplateName("quota_limit_reached", { status: "REJECTED", category: "UTILITY" }),
  "quota_limit_reached"
);
assert.equal(
  approvedUtilityQuotaTemplateName("quota_warning_80", null),
  "quota_warning_80"
);

assert.equal(
  shouldSuppressLeadTemplate({ category: "UTILITY", optedOut: false, marketingOptedOut: true }),
  false
);
