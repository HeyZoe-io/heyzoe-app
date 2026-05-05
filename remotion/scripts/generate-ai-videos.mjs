import fs from "node:fs/promises";
import path from "node:path";

// Cheap / open-source image-to-video model that exists on Replicate:
// ali-vilab/i2vgen-xl (note: marked RESEARCH/NON-COMMERCIAL USE ONLY by model owner)
const MODEL = "ali-vilab/i2vgen-xl";
const API_BASE = "https://api.replicate.com/v1";

const ASSET_DIR = path.resolve(process.cwd(), "public", "ai");

function requireEnv(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) {
    throw new Error(`${name} is required. Example: ${name}=... npm run gen:video`);
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
    throw new Error(`Replicate API ${res.status} ${res.statusText}: ${text.slice(0, 600)}`);
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
    if (Date.now() - startedAt > 12 * 60 * 1000) {
      throw new Error(`Prediction ${pred.id} timed out waiting for success`);
    }
    await sleep(1500);
    pred = await getPrediction(token, pred.id);
  }
  const out = pred.output;
  if (typeof out !== "string" || !out.startsWith("http")) {
    throw new Error(`Unexpected output for prediction ${pred.id}: ${JSON.stringify(out).slice(0, 200)}`);
  }
  return out;
}

async function uploadFile(token, filePath, contentType) {
  const filename = path.basename(filePath);
  const buf = await fs.readFile(filePath);
  const form = new FormData();
  form.set("content", new Blob([buf], { type: contentType }), filename);
  form.set("filename", filename);
  form.set("type", contentType);
  form.set("metadata", new Blob([JSON.stringify({ purpose: "heyzoe-remotion" })], { type: "application/json" }));

  const res = await replicateFetch(token, `${API_BASE}/files`, { method: "POST", body: form });
  const j = await res.json();
  // Best effort: prefer a direct URL if present; otherwise fall back to the file id (some endpoints accept it).
  const url = j?.urls?.get || j?.urls?.download || j?.url || null;
  return { id: j?.id || null, url };
}

async function download(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(outPath, buf);
}

const CLIPS = [
  {
    still: "scene1_instagram.jpg",
    out: "scene1_instagram.mp4",
    prompt:
      "Photorealistic vertical video, same woman in her 30s with dark hair in a cozy living room scrolling her phone; her face is lit by the screen glow; she looks excited when seeing a trampoline studio ad; subtle natural head and hand movement.",
  },
  {
    still: "scene2_cooking_chaos.jpg",
    out: "scene2_cooking_chaos.mp4",
    prompt:
      "Photorealistic vertical video, same woman cooking in a chaotic kitchen with kids in the background; she answers a ringing phone and looks stressed; subtle natural body movement; comedic but realistic.",
  },
  {
    still: "scene3_birthday_restaurant.jpg",
    out: "scene3_birthday_restaurant.mp4",
    prompt:
      "Photorealistic vertical video, same woman at a birthday dinner in a restaurant with friends singing; her phone interrupts and she looks annoyed; candlelight bokeh; subtle natural movement.",
  },
  {
    still: "scene4_skydiving.jpg",
    out: "scene4_skydiving.mp4",
    prompt:
      "Photorealistic vertical video, same woman in a skydiving jumpsuit at the airplane door with strong wind; she struggles to hear a ringing phone; dramatic sky outside; realistic motion.",
  },
];

async function main() {
  const token = requireEnv("REPLICATE_API_TOKEN");
  await fs.mkdir(ASSET_DIR, { recursive: true });

  console.log(`Generating ${CLIPS.length} AI video clips into ${ASSET_DIR}`);
  console.log(`Model: ${MODEL}`);

  for (const [i, c] of CLIPS.entries()) {
    const stillPath = path.join(ASSET_DIR, c.still);
    const outPath = path.join(ASSET_DIR, c.out);

    console.log(`\n[${i + 1}/${CLIPS.length}] ${c.out}`);
    const up = await uploadFile(token, stillPath, "image/jpeg");
    const image = up.url || up.id;
    if (!image) throw new Error("Failed to upload image");

    const url = await runToCompletion(token, {
      image,
      prompt: c.prompt,
      max_frames: 16,
      num_inference_steps: 40,
      guidance_scale: 9,
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

