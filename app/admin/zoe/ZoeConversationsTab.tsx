"use client";

import { useEffect, useMemo, useState } from "react";
import ConversationsClient from "@/app/[slug]/conversations/client";

const PURPLE = "#7133da";
const MUTED = "#6b5b9a";

export type ZoeBusinessOption = {
  slug: string;
  name: string | null;
};

type SessionSummary = {
  session_id: string;
  lastAt: string;
  count: number;
  isOpen: boolean;
  isPaused: boolean;
  phone: string;
};

export default function ZoeConversationsTab({ businesses }: { businesses: ZoeBusinessOption[] }) {
  const sorted = useMemo(
    () => [...businesses].sort((a, b) => (a.name || a.slug).localeCompare(b.name || b.slug, "he")),
    [businesses]
  );

  const [slug, setSlug] = useState("");
  const [initialSessions, setInitialSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState("");

  useEffect(() => {
    if (!slug && sorted.length) setSlug(sorted[0]!.slug);
  }, [slug, sorted]);

  useEffect(() => {
    if (!slug) {
      setInitialSessions([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadErr("");
    void (async () => {
      try {
        const res = await fetch(`/api/admin/conversations?slug=${encodeURIComponent(slug)}`, {
          cache: "no-store",
        });
        const j = (await res.json().catch(() => ({}))) as { sessions?: SessionSummary[]; error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setLoadErr(j.error?.trim() || `שגיאת טעינה (${res.status})`);
          setInitialSessions([]);
          return;
        }
        setInitialSessions(Array.isArray(j.sessions) ? j.sessions : []);
      } catch {
        if (!cancelled) {
          setLoadErr("בעיית רשת בטעינת שיחות.");
          setInitialSessions([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const selectedBiz = sorted.find((b) => b.slug === slug);

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <p style={{ margin: 0, fontSize: 14, color: MUTED, lineHeight: 1.55, textAlign: "right" }}>
        מעקב אחרי שיחות וואטסאפ / צ׳אט לפי עסק — עצירת בוט ומענה ידני כמו בדשבורד בעל העסק.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end", marginTop: 16 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 220px", textAlign: "right" }}>
          <span style={{ fontSize: 12, color: MUTED }}>בחר עסק</span>
          <select
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            style={{
              borderRadius: 10,
              border: `1px solid rgba(113,51,218,0.22)`,
              padding: "10px 12px",
              fontFamily: "inherit",
              fontSize: 14,
              background: "#fff",
            }}
          >
            {sorted.map((b) => (
              <option key={b.slug} value={b.slug}>
                {(b.name || b.slug).trim()} ({b.slug})
              </option>
            ))}
          </select>
        </label>
        {selectedBiz ? (
          <a
            href={`/${encodeURIComponent(selectedBiz.slug)}/conversations`}
            style={{ fontSize: 13, color: PURPLE, textDecoration: "underline", textUnderlineOffset: 3 }}
          >
            פתיחה בדשבורד העסק
          </a>
        ) : null}
      </div>

      {loadErr ? (
        <p style={{ margin: "12px 0 0", fontSize: 13, color: "#b42318" }} role="alert">
          {loadErr}
        </p>
      ) : null}

      {!sorted.length ? (
        <p style={{ margin: "16px 0 0", fontSize: 14, color: MUTED, textAlign: "right" }}>אין עסקים במערכת.</p>
      ) : loading && !initialSessions.length ? (
        <p style={{ margin: "16px 0 0", fontSize: 14, color: MUTED, textAlign: "right" }}>טוען שיחות…</p>
      ) : slug ? (
        <div style={{ marginTop: 16 }}>
          <ConversationsClient key={slug} slug={slug} initialSessions={initialSessions} apiScope="admin" />
        </div>
      ) : null}
    </div>
  );
}
