import assert from "node:assert/strict";
import { resolveTemplateFirstName } from "@/lib/template-first-name";

assert.equal(resolveTemplateFirstName({ full_name: "Eliav_yosef" }), null);
assert.equal(resolveTemplateFirstName({ full_name: "Studio Pixel" }), null);
assert.equal(resolveTemplateFirstName({ full_name: "קרבון גריפ" }), "קרבון");
assert.equal(resolveTemplateFirstName({ full_name: "רחל" }), "רחל");
assert.equal(resolveTemplateFirstName({ full_name: "Amitay Klein" }), "Amitay");
assert.equal(resolveTemplateFirstName({ full_name: "user123" }), null);

assert.equal(resolveTemplateFirstName({ full_name: "אייזן רחל" }, "רחל אייזן"), "רחל");
assert.equal(resolveTemplateFirstName({ full_name: "Studio Pixel" }, "דנה כהן"), "דנה");
assert.equal(resolveTemplateFirstName({ full_name: null }), null);
assert.equal(resolveTemplateFirstName({ full_name: "א" }), null);
