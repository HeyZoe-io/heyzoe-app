import fs from "node:fs/promises";
import path from "node:path";

// NOTE: The Replicate model slug `stability-ai/stable-video-diffusion` is not currently available via Replicate.
// The closest Stable Video Diffusion implementation available is `sunfjun/stable-video-diffusion`.
const MODEL = "sunfjun/stable-video-diffusion";
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
  },
  {
    still: "scene2_cooking_chaos.jpg",
    out: "scene2_cooking_chaos.mp4",
  },
  {
    still: "scene3_birthday_restaurant.jpg",
    out: "scene3_birthday_restaurant.mp4",
  },
  {
    still: "scene4_skydiving.jpg",
    out: "scene4_skydiving.mp4",
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
    const input_image = up.url || up.id;
    if (!input_image) throw new Error("Failed to upload input_image");

    const url = await runToCompletion(token, {
      input_image,
      video_length: "14_frames_with_svd",
      sizing_strategy: "maintain_aspect_ratio",
      frames_per_second: 6,
      motion_bucket_id: 127,
      cond_aug: 0.02,
      decoding_t: 14,
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

