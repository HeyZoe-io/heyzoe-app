import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tiny endpoint to verify which commit Vercel deployed.
 * Vercel sets VERCEL_GIT_COMMIT_SHA at build/runtime for Git deployments.
 */
export async function GET() {
  const sha = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").trim();
  const ref = (process.env.VERCEL_GIT_COMMIT_REF ?? "").trim();
  return NextResponse.json({
    ok: true,
    vercel_git_commit_sha: sha || null,
    vercel_git_commit_ref: ref || null,
    node_env: process.env.NODE_ENV ?? null,
  });
}
