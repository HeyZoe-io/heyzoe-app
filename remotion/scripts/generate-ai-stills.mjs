import fs from "node:fs/promises";
import path from "node:path";

const MODEL = "black-forest-labs/flux-2-pro";
const API_BASE = "https://api.replicate.com/v1";

const OUT_DIR = path.resolve(process.cwd(), "public", "ai");
const SEED = 314159; // same seed for all scenes (per request)

function requireEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) {
    throw new Error(`${name} is required. Example: ${name}=... npm run gen:ai`);
  }
  return String(v).trim();
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function replicateFetch(token, url, init) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Replicate API ${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
  }
  return res;
}

async function createPrediction(token, input) {
  const res = await replicateFetch(token, `${API_BASE}/models/${MODEL}/predictions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  });
  return await res.json();
}

async function getPrediction(token, id) {
  const res = await replicateFetch(token, `${API_BASE}/predictions/${id}`, { method: "GET" });
  return await res.json();
}

async function runToCompletion(token, input) {
  const created = await createPrediction(token, input);
  let pred = created;
  const startedAt = Date.now();
  while (pred.status !== "succeeded") {
    if (pred.status === "failed" || pred.status === "canceled") {
      throw new Error(`Prediction ${pred.id} ended with status=${pred.status}: ${pred.error ?? ""}`);
    }
    if (Date.now() - startedAt > 6 * 60 * 1000) {
      throw new Error(`Prediction ${pred.id} timed out waiting for success`);
    }
    await sleep(1200);
    pred = await getPrediction(token, pred.id);
  }
  const out = pred.output;
  if (typeof out !== "string" || !out.startsWith("http")) {
    throw new Error(`Unexpected output for prediction ${pred.id}: ${JSON.stringify(out).slice(0, 200)}`);
  }
  return out;
}

async function download(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(outPath, buf);
}

function baseCharacter() {
  return [
    "Photorealistic cinematic still, vertical 9:16",
    "same woman across scenes",
    "woman in her 30s, dark hair, everyday casual look, natural makeup",
    "realistic skin texture, natural hands, accurate anatomy",
    "no logos, no watermarks, no brand names",
    "high detail, shallow depth of field, film look",
  ].join(", ");
}

const SCENES = [
  {
    filename: "scene1_instagram.jpg",
    prompt: [
      baseCharacter(),
      "living room at night, cozy couch",
      "woman scrolling on her smartphone, her face lit by the screen glow",
      "on the phone screen: a generic social feed sponsored post about rebound boots trampoline fitness class, women jumping on spring shoes in a bright studio",
      "her expression: intrigued, eyes bright, slight smile",
      "composition leaves negative space at top and bottom for captions",
    ].join(", "),
  },
  {
    filename: "scene2_cooking_chaos.jpg",
    prompt: [
      baseCharacter(),
      "home kitchen, chaotic comedic vibe",
      "woman cooking at the counter, steam from pots, messy counter",
      "two small kids in the background shouting and running, subtle motion blur",
      "phone in her hand showing a generic incoming call screen",
      "warm indoor lighting, candid documentary feel",
      "composition leaves negative space for subtitles",
    ].join(", "),
  },
  {
    filename: "scene3_birthday_restaurant.jpg",
    prompt: [
      baseCharacter(),
      "restaurant with friends, birthday celebration",
      "friends clapping and singing, birthday cake with candles on the table",
      "woman looks slightly annoyed as her phone rings and interrupts",
      "phone screen shows generic incoming call",
      "warm bokeh lights, candid photorealism",
      "composition leaves negative space for subtitles",
    ].join(", "),
  },
  {
    filename: "scene4_skydiving.jpg",
    prompt: [
      baseCharacter(),
      "inside an airplane, open door, dramatic sky outside",
      "woman in a skydiving jumpsuit with goggles at the edge of the door",
      "strong wind blowing, she is holding a ringing phone and struggling to hear",
      "comedic but realistic",
      "composition leaves negative space for captions",
    ].join(", "),
  },
];

async function main() {
  const token = requireEnv("REPLICATE_API_TOKEN");
  await fs.mkdir(OUT_DIR, { recursive: true });

  console.log(`Generating ${SCENES.length} AI stills into ${OUT_DIR}`);
  console.log(`Model: ${MODEL}`);
  console.log(`Seed: ${SEED}`);

  for (const [i, s] of SCENES.entries()) {
    const outPath = path.join(OUT_DIR, s.filename);
    console.log(`\n[${i + 1}/${SCENES.length}] ${s.filename}`);

    const url = await runToCompletion(token, {
      prompt: s.prompt,
      aspect_ratio: "9:16",
      resolution: "2 MP",
      output_format: "jpg",
      output_quality: 90,
      safety_tolerance: 2,
      seed: SEED,
    });

    await download(url, outPath);
    console.log(`Saved: ${outPath}`);
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});

