import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { resolveSupabaseStorageBucket } from "@/lib/server-env";

export const runtime = "nodejs";

function isBucketMissingError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("bucket not found") || m.includes("not found") && m.includes("bucket");
}

async function ensurePublicBucket(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  bucketId: string
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await admin.storage.createBucket(bucketId, {
    public: true,
    fileSizeLimit: 5 * 1024 * 1024,
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

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  /** מגבלת גוף בקשה טיפוסית ב-Vercel ~4.5MB — מונעים העלאה שתיכשל בשקט */
  const MAX_BYTES = 4 * 1024 * 1024;
  if (buffer.length > MAX_BYTES) {
    return NextResponse.json(
      {
        error:
          "הקובץ גדול מדי (מקסימום 4MB בהעלאה מהדפדפן). נסו סרטון קצר יותר, כיווץ, או תמונה.",
      },
      { status: 413 }
    );
  }
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${user.id}/${Date.now()}-${safeName}`;

  const admin = createSupabaseAdminClient();
  const bucket = resolveSupabaseStorageBucket();

  const uploadOnce = () =>
    admin.storage.from(bucket).upload(path, buffer, {
      contentType: file.type || "application/octet-stream",
      upsert: true,
    });

  let { error } = await uploadOnce();

  if (error && isBucketMissingError(error.message)) {
    const ensured = await ensurePublicBucket(admin, bucket);
    if (ensured.ok) {
      ({ error } = await uploadOnce());
    } else {
      return NextResponse.json(
        {
          error:
            `דלי Storage "${bucket}" לא קיים ולא ניתן ליצור אותו: ${ensured.error ?? "שגיאה לא ידועה"}. ` +
            "הריצו את supabase/storage_business_assets.sql ב-SQL Editor או הגדירו SUPABASE_STORAGE_BUCKET לשם דלי קיים.",
        },
        { status: 400 }
      );
    }
  }

  if (error) {
    const msg = error.message ?? "upload_failed";
    const friendly =
      isBucketMissingError(msg) || msg.toLowerCase().includes("bucket not found")
        ? `דלי "${bucket}" לא נמצא ב-Supabase. צרו דלי ציבורי בשם זה (או הגדירו SUPABASE_STORAGE_BUCKET) והריצו את supabase/storage_business_assets.sql.`
        : msg;
    return NextResponse.json({ error: friendly }, { status: 400 });
  }

  const { data } = admin.storage.from(bucket).getPublicUrl(path);
  return NextResponse.json({ url: data.publicUrl });
}
