import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { resolveSupabaseStorageBucket } from "@/lib/server-env";

export const runtime = "nodejs";

const MAX_BYTES = 16 * 1024 * 1024;

function isBucketMissingError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("bucket not found") || (m.includes("not found") && m.includes("bucket"));
}

async function ensurePublicBucket(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  bucketId: string
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await admin.storage.createBucket(bucketId, {
    public: true,
    fileSizeLimit: MAX_BYTES,
  });
  if (!error) return { ok: true };
  const msg = error.message ?? "";
  if (/already exists|duplicate|exists/i.test(msg)) return { ok: true };
  return { ok: false, error: msg };
}

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { filename?: string; contentType?: string; fileSize?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const filename = typeof body.filename === "string" ? body.filename : "";
  if (!filename.trim()) {
    return NextResponse.json({ error: "missing_filename" }, { status: 400 });
  }

  const fileSize = typeof body.fileSize === "number" ? body.fileSize : null;
  if (fileSize !== null && (fileSize <= 0 || fileSize > MAX_BYTES)) {
    return NextResponse.json(
      {
        error: `הקובץ גדול מדי (מקסימום ${MAX_BYTES / (1024 * 1024)}MB).`,
      },
      { status: 413 }
    );
  }

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${user.id}/${Date.now()}-${safeName}`;

  const admin = createSupabaseAdminClient();
  const bucket = resolveSupabaseStorageBucket();

  const trySign = () =>
    admin.storage.from(bucket).createSignedUploadUrl(path, { upsert: true });

  let { data, error } = await trySign();

  if (error && isBucketMissingError(error.message)) {
    const ensured = await ensurePublicBucket(admin, bucket);
    if (ensured.ok) {
      ({ data, error } = await trySign());
    } else {
      return NextResponse.json(
        {
          error:
            `דלי Storage "${bucket}" לא קיים ולא ניתן ליצור אותו: ${ensured.error ?? "שגיאה לא ידועה"}.`,
        },
        { status: 400 }
      );
    }
  }

  if (error || !data) {
    const msg = error?.message ?? "signed_url_failed";
    const friendly =
      isBucketMissingError(msg) || msg.toLowerCase().includes("bucket not found")
        ? `דלי "${bucket}" לא נמצא ב-Supabase. הגדירו מגבלת 16MB בדלי והריצו את supabase/storage_business_assets.sql אם צריך.`
        : msg;
    return NextResponse.json({ error: friendly }, { status: 400 });
  }

  const { data: pub } = admin.storage.from(bucket).getPublicUrl(path);

  return NextResponse.json({
    signedUrl: data.signedUrl,
    token: data.token,
    path: data.path,
    publicUrl: pub.publicUrl,
  });
}
