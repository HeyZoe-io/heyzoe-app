import assert from "node:assert/strict";
import {
  buildOwnerAddressedGreetingReply,
  isOwnerAddressedGreeting,
  parseOwnerAddressedGreeting,
  rewriteAcademyReceptionistIdentity,
} from "@/lib/wa-owner-addressed-greeting";

assert.deepEqual(parseOwnerAddressedGreeting("אהלן יגאל זה דוד"), {
  ownerName: "יגאל",
  leadName: "דוד",
});
assert.equal(isOwnerAddressedGreeting("אהלן יגאל זה דוד"), true);
assert.equal(
  buildOwnerAddressedGreetingReply("גל", { ownerName: "יגאל", leadName: "דוד" }),
  "היי דוד! כאן גל, הבוטית של יגאל. איך אפשר לעזור?"
);

assert.deepEqual(parseOwnerAddressedGreeting("היי יגאל כאן דוד"), {
  ownerName: "יגאל",
  leadName: "דוד",
});
assert.deepEqual(parseOwnerAddressedGreeting("אהלן יגאל זה דוד ג׳רפי"), {
  ownerName: "יגאל",
  leadName: "דוד גרפי",
});

assert.equal(parseOwnerAddressedGreeting("אהלן אשמח לפרטים"), null);
assert.equal(parseOwnerAddressedGreeting("היי"), null);
assert.equal(parseOwnerAddressedGreeting("אהלן יגאל מה קורה"), null);
assert.equal(parseOwnerAddressedGreeting("רוצה שיעור ניסיון אצל יגאל"), null);

assert.equal(
  rewriteAcademyReceptionistIdentity(
    "היי דוד! 👋 אני גל, נציגת השירות של האקדמיה. יגאל הוא המאמן שלנו 🥋 איך אפשר לעזור לך? 💜",
    "גל",
    "יגאל"
  ),
  "היי! כאן גל, הבוטית של יגאל. איך אפשר לעזור?"
);

assert.doesNotMatch(
  rewriteAcademyReceptionistIdentity(
    "היי דוד! אני גל, נציגת השירות של האקדמיה. יגאל הוא המאמן שלנו",
    "גל",
    "יגאל"
  ),
  /אקדמיה|המאמן שלנו/
);

assert.equal(
  rewriteAcademyReceptionistIdentity("השיעורים ביום ראשון ב-17:30", "גל", "יגאל"),
  "השיעורים ביום ראשון ב-17:30"
);

console.log("wa-owner-addressed-greeting.test.ts: ok");
