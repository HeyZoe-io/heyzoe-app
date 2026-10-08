import assert from "node:assert/strict";
import {
  arboxTaskStatusIsRetryable,
  postArboxTaskWithRetry,
  renderCrmTaskFailureContent,
} from "./arbox-task-retry";

async function main() {
  const sleeps: number[] = [];
  const sleep = async (ms: number) => void sleeps.push(ms);
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    // 500 then ok → task created on the second try (the 8.10 Tights case)
    let n = 0;
    const r1 = await postArboxTaskWithRetry(async () => (++n === 1 ? { ok: false, status: 500 } : { ok: true, status: 201 }), { sleep });
    assert.deepEqual(r1, { ok: true, status: 201, attempts: 2 });
    assert.deepEqual(sleeps, [1000]);

    // 500 three times → gives up after 3 attempts, delays 1s then 3s
    sleeps.length = 0;
    const r2 = await postArboxTaskWithRetry(async () => ({ ok: false, status: 500 }), { sleep });
    assert.deepEqual(r2, { ok: false, status: 500, attempts: 3 });
    assert.deepEqual(sleeps, [1000, 3000]);

    // 400 is final: no retry
    sleeps.length = 0;
    const r3 = await postArboxTaskWithRetry(async () => ({ ok: false, status: 400 }), { sleep });
    assert.equal(r3.attempts, 1);
    assert.deepEqual(sleeps, []);

    // network / timeout (status 0) retries
    let m = 0;
    const r4 = await postArboxTaskWithRetry(async () => (++m < 3 ? { ok: false, status: 0 } : { ok: true, status: 200 }), { sleep });
    assert.equal(r4.ok, true);
    assert.equal(r4.attempts, 3);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(arboxTaskStatusIsRetryable(429), true);
  assert.equal(arboxTaskStatusIsRetryable(404), false);
  assert.match(
    renderCrmTaskFailureContent({ businessId: 3543, userId: "4454870", taskTypeId: 64307, kind: "human_requested", status: 500, attempts: 3 }),
    /3543.*4454870.*64307.*500/
  );
  console.log("arbox-task-retry tests passed");
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
