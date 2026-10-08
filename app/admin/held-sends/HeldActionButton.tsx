"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Payload =
  | { action: "release" | "cancel"; ids: string[] }
  | { action: "release" | "cancel"; group: { business_id: number; reason: string } }
  | { action: "resume"; business_id: number; trigger_key: string };

export function HeldActionButton({ label, payload, confirmText }: { label: string; payload: Payload; confirmText?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function run() {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/held-sends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        released?: number;
        sent_now?: number;
        canceled?: number;
        failed?: number;
      };
      if (!res.ok) {
        setNote(body.error ?? `שגיאה ${res.status}`);
      } else if (payload.action !== "resume") {
        const parts = [
          body.released ? `שוחררו ${body.released}` : "",
          body.sent_now ? `נשלחו עכשיו ${body.sent_now}` : "",
          body.canceled ? `בוטלו ${body.canceled}` : "",
          body.failed ? `נכשלו ${body.failed}` : "",
        ].filter(Boolean);
        setNote(parts.join(", ") || "אין שינוי");
      }
      router.refresh();
    } catch {
      setNote("שגיאת רשת");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        style={{
          padding: "4px 10px",
          borderRadius: 8,
          border: "1px solid rgba(113,51,218,0.3)",
          background: payload.action === "cancel" ? "white" : "#7133da",
          color: payload.action === "cancel" ? "#7133da" : "white",
          cursor: busy ? "wait" : "pointer",
          fontSize: 12,
        }}
      >
        {busy ? "…" : label}
      </button>
      {note ? <span style={{ fontSize: 12, color: "#555" }}>{note}</span> : null}
    </span>
  );
}
