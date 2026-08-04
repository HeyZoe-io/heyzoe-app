import assert from "node:assert/strict";
import {
  parseIncomingLeadBodyText,
  parseIncomingLeadFields,
} from "@/lib/leads/parse-incoming-lead-fields";

/** Zapier / legacy JSON keys */
{
  const parsed = parseIncomingLeadFields({
    full_name: "דנה כהן",
    phone: "0501234567",
  });
  assert.equal(parsed.fullName, "דנה כהן");
  assert.equal(parsed.phoneRaw, "0501234567");
}

/** Elementor Custom IDs: name + tel */
{
  const parsed = parseIncomingLeadFields({
    name: "יוסי",
    tel: "052-9998877",
  });
  assert.equal(parsed.fullName, "יוסי");
  assert.equal(parsed.phoneRaw, "052-9998877");
}

/** Hebrew field keys */
{
  const parsed = parseIncomingLeadFields({
    שם: "מיכל לוי",
    טלפון: "0541112233",
  });
  assert.equal(parsed.fullName, "מיכל לוי");
  assert.equal(parsed.phoneRaw, "0541112233");
}

/** Nested Elementor-style fields bag */
{
  const parsed = parseIncomingLeadFields({
    fields: {
      full_name: "נועה",
      whatsapp: "0534445566",
    },
  });
  assert.equal(parsed.fullName, "נועה");
  assert.equal(parsed.phoneRaw, "0534445566");
}

/** Case / spacing variants */
{
  const parsed = parseIncomingLeadFields({
    Full_Name: "A B",
    Phone_Number: "0500000000",
  });
  assert.equal(parsed.fullName, "A B");
  assert.equal(parsed.phoneRaw, "0500000000");
}

/** URL-encoded body text */
{
  const body = parseIncomingLeadBodyText(
    "full_name=%D7%93%D7%A0%D7%94&phone=0501234567",
    "application/x-www-form-urlencoded"
  );
  assert.ok(body);
  const parsed = parseIncomingLeadFields(body!);
  assert.equal(parsed.fullName, "דנה");
  assert.equal(parsed.phoneRaw, "0501234567");
}

/** JSON body text */
{
  const body = parseIncomingLeadBodyText(
    JSON.stringify({ name: "Sam", mobile: "0501111111" }),
    "application/json"
  );
  assert.ok(body);
  const parsed = parseIncomingLeadFields(body!);
  assert.equal(parsed.fullName, "Sam");
  assert.equal(parsed.phoneRaw, "0501111111");
}

console.log("parse-incoming-lead-fields.test.ts: ok");
