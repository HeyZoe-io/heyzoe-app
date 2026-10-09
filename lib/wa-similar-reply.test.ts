import assert from "node:assert/strict";
import { repliesAreSimilar } from "@/lib/wa-similar-reply";

const age =
  "לצערי, מנוי הנערות מיועד לגילאים 10-15, אז הגיל 9 קצת מתחת לטווח שלנו. אני מעבירה את הבקשה לצוות ויצרו איתך קשר כדי שנבדוק אם יש אפשרות להתאמה מיוחדת עבור הבת שלך 💜";

assert.equal(
  repliesAreSimilar(age + "\n\nיש עוד משהו שאני יכולה לעזור לך איתו?", age),
  true
);
assert.equal(
  repliesAreSimilar(age.replace("לצערי", "למצטערי") + "\n\nיש עוד משהו שאני יכולה לעזור לך איתו?", age),
  true
);
assert.equal(repliesAreSimilar(age, "כמובן, חשוב לבדוק"), false);
assert.equal(
  repliesAreSimilar(age, `${age} כמובן, חשוב לבדוק שהאימון מתאים ולא גורם נזק.`),
  false
);

console.log("wa-similar-reply.test.ts: ok");
