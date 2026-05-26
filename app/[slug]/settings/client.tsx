"use client";

import { useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import SettingsClient from "../../dashboard/[slug]/settings/page";

const SETTINGS_PRESENCE_PREFIX = "settings";

type PresencePayload = {
  client_id?: string;
  user_id?: string;
  name?: string;
  online_at?: string;
};

function pickEarliest(rows: PresencePayload[]): PresencePayload | null {
  return [...rows].sort((a, b) => {
    const at = String(a.online_at ?? "");
    const bt = String(b.online_at ?? "");
    if (at !== bt) return at.localeCompare(bt);
    return String(a.client_id ?? "").localeCompare(String(b.client_id ?? ""));
  })[0] ?? null;
}

export default function SettingsPresenceClient({ slug }: { slug: string }) {
  const [settingsPresenceLocked, setSettingsPresenceLocked] = useState(false);
  const [settingsPresenceEditorName, setSettingsPresenceEditorName] = useState("");
  const settingsPresenceClientIdRef = useRef("");

  useEffect(() => {
    const businessSlug = String(slug ?? "").trim().toLowerCase();
    if (!businessSlug) return;

    let cancelled = false;
    const supabase = createSupabaseBrowserClient();
    let presenceChannel: ReturnType<typeof supabase.channel> | null = null;
    const clientId =
      settingsPresenceClientIdRef.current ||
      (typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2));
    settingsPresenceClientIdRef.current = clientId;

    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      const user = data.user;
      const userId = String(user?.id ?? "").trim();
      const userName =
        String(user?.user_metadata?.full_name ?? "").trim() ||
        String(user?.user_metadata?.name ?? "").trim() ||
        String(user?.email ?? "").trim() ||
        "משתמש";

      const channel = supabase.channel(`${SETTINGS_PRESENCE_PREFIX}-${businessSlug}`, {
        config: { presence: { key: clientId } },
      });
      presenceChannel = channel;

      const updateLockState = () => {
        if (cancelled) return;
        const state = channel.presenceState() as Record<string, PresencePayload[]>;
        const presences = Object.values(state).flat();
        const currentUserPresences = presences.filter((presence) => {
          const presenceClientId = String(presence.client_id ?? "");
          const presenceUserId = String(presence.user_id ?? "").trim();
          return presenceClientId === clientId || Boolean(userId && presenceUserId === userId);
        });
        const otherUserPresences = presences.filter((presence) => {
          const presenceClientId = String(presence.client_id ?? "");
          const presenceUserId = String(presence.user_id ?? "").trim();
          if (presenceClientId === clientId) return false;
          if (userId && presenceUserId === userId) return false;
          return true;
        });

        const currentEditor = pickEarliest(currentUserPresences);
        const otherEditor = pickEarliest(otherUserPresences);
        const shouldLock = Boolean(
          otherEditor &&
            (!currentEditor ||
              String(otherEditor.online_at ?? "").localeCompare(String(currentEditor.online_at ?? "")) <= 0)
        );

        setSettingsPresenceLocked(shouldLock);
        setSettingsPresenceEditorName(shouldLock ? String(otherEditor?.name ?? "משתמש אחר").trim() : "");
      };

      channel
        .on("presence", { event: "sync" }, updateLockState)
        .on("presence", { event: "join" }, updateLockState)
        .on("presence", { event: "leave" }, updateLockState)
        .subscribe((status) => {
          if (status !== "SUBSCRIBED" || cancelled) return;
          void channel.track({
            client_id: clientId,
            user_id: userId,
            name: userName,
            online_at: new Date().toISOString(),
          });
        });

      updateLockState();
    })();

    return () => {
      cancelled = true;
      if (presenceChannel) {
        void presenceChannel.untrack();
        void supabase.removeChannel(presenceChannel);
      }
    };
  }, [slug]);

  return (
    <SettingsClient
      settingsPresenceLocked={settingsPresenceLocked}
      settingsPresenceEditorName={settingsPresenceEditorName}
    />
  );
}
