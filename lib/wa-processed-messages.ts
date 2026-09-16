import { createSupabaseAdminClient } from "@/lib/supabase-admin";

/**
 * Dedup עמיד בין אינסטנסים: Vercel לא חולק זיכרון, ו-retry של Meta/Twilio
 * (או שני webhook URLs על אותה WABA) מגיע לאינסטנס אחר ומעבד את אותה הודעה שוב.
 * INSERT אטומי לפי message_id; conflict = כפילות → לא לעבד שוב.
 * מחזיר true אם ההודעה "נתפסה" לעיבוד, false אם כבר עובדה.
 * fail-open: אם הטבלה חסרה / שגיאה לא צפויה — מעבדים.
 */
export async function claimMessageForProcessing(messageId: string): Promise<boolean> {
  if (!messageId) return true;
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.from("wa_processed_messages").insert({ message_id: messageId });
    if (!error) {
      if (Math.random() < 0.02) {
        const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
        await admin
          .from("wa_processed_messages")
          .delete()
          .lt("processed_at", cutoff)
          .then(undefined, () => {});
      }
      return true;
    }
    if (error.code === "23505") {
      console.info(`[WA Webhook] Skipping duplicate (durable) ${messageId}`);
      return false;
    }
    if (/wa_processed_messages|relation|does not exist|schema cache/i.test(error.message)) {
      console.warn("[WA Webhook] durable dedup unavailable, falling back to in-memory:", error.message);
      return true;
    }
    console.error("[WA Webhook] durable dedup insert error:", error.message);
    return true;
  } catch (e) {
    console.error("[WA Webhook] durable dedup exception:", e);
    return true;
  }
}
