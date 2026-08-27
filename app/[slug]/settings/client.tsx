"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { dashboardDir, dashboardLangFromParam } from "@/lib/dashboard-lang";
import { dashboardSettingsT, formatConcurrentEditorNames } from "@/lib/dashboard-settings-i18n";
import {
  pickEarliestPresence,
  presenceDedupeKey,
  resolvePresencePopup,
  type SettingsPresencePayload,
} from "@/lib/settings-presence";
import { Button } from "@/components/ui/button";
import SettingsClient from "../../dashboard/[slug]/settings/page";

const SETTINGS_PRESENCE_PREFIX = "settings";

/** TEMP: turn off exclusive-edit lock so two people can edit the same dashboard. Set back to true to restore. */
const SETTINGS_PRESENCE_LOCK_ENABLED = false;

function PresencePopup({
  open,
  message,
  okLabel,
  dir,
  onDismiss,
}: {
  open: boolean;
  message: string;
  okLabel: string;
  dir: "rtl" | "ltr";
  onDismiss: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onDismiss}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
        dir={dir}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-presence-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <p
          id="settings-presence-dialog-title"
          className="text-base font-medium leading-relaxed text-zinc-900"
        >
          {message}
        </p>
        <div className="mt-6 flex justify-start">
          <Button type="button" className="rounded-2xl px-5" onClick={onDismiss}>
            {okLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPresenceClient({
  slug,
  isAdmin = false,
}: {
  slug: string;
  isAdmin?: boolean;
}) {
  const searchParams = useSearchParams();
  const lang = dashboardLangFromParam(searchParams.get("lang"));
  const t = dashboardSettingsT(lang);
  const [settingsPresenceLocked, setSettingsPresenceLocked] = useState(false);
  const [settingsPresenceEditorName, setSettingsPresenceEditorName] = useState("");
  const [presencePopupOpen, setPresencePopupOpen] = useState(false);
  const [presencePopupNames, setPresencePopupNames] = useState<string[]>([]);
  const settingsPresenceClientIdRef = useRef("");
  const acknowledgedPresenceIdsRef = useRef(new Set<string>());
  const liveOtherPresenceIdsRef = useRef<string[]>([]);

  useEffect(() => {
    const businessSlug = String(slug ?? "").trim().toLowerCase();
    if (!businessSlug) return;

    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
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
        t.user;

      const channel = supabase.channel(`${SETTINGS_PRESENCE_PREFIX}-${businessSlug}`, {
        config: { presence: { key: clientId, enabled: true } },
      });
      presenceChannel = channel;

      const updateLockState = () => {
        if (cancelled) return;
        const state = channel.presenceState() as Record<string, SettingsPresencePayload[]>;
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

        const currentEditor = pickEarliestPresence(currentUserPresences);
        const otherEditor = pickEarliestPresence(otherUserPresences);
        const shouldLock =
          SETTINGS_PRESENCE_LOCK_ENABLED &&
          Boolean(
            otherEditor &&
              (!currentEditor ||
                String(otherEditor.online_at ?? "").localeCompare(String(currentEditor.online_at ?? "")) <= 0)
          );

        setSettingsPresenceLocked(shouldLock);
        setSettingsPresenceEditorName(shouldLock ? String(otherEditor?.name ?? t.otherUser).trim() : "");

        const popup = resolvePresencePopup({
          currentUserIsAdmin: isAdmin,
          otherPresences: otherUserPresences,
          fallbackName: t.otherUser,
        });
        const liveIds = otherUserPresences.map(presenceDedupeKey).filter(Boolean);
        liveOtherPresenceIdsRef.current = liveIds;
        const liveIdSet = new Set(liveIds);
        for (const id of [...acknowledgedPresenceIdsRef.current]) {
          if (!liveIdSet.has(id)) acknowledgedPresenceIdsRef.current.delete(id);
        }
        const hasNewEditor = liveIds.some((id) => !acknowledgedPresenceIdsRef.current.has(id));
        setPresencePopupNames(popup.editorNames);
        setPresencePopupOpen(popup.show && hasNewEditor);
      };

      channel
        .on("presence", { event: "sync" }, updateLockState)
        .on("presence", { event: "join" }, updateLockState)
        .on("presence", { event: "leave" }, updateLockState)
        .subscribe(async (status, err) => {
          if (cancelled) return;
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.warn("[SettingsPresence] realtime channel failed:", status, err);
            return;
          }
          if (status !== "SUBSCRIBED") return;
          const trackStatus = await channel.track({
            client_id: clientId,
            user_id: userId,
            name: userName,
            is_admin: isAdmin,
            online_at: new Date().toISOString(),
          });
          if (trackStatus !== "ok") {
            console.warn("[SettingsPresence] track failed:", trackStatus);
          }
          updateLockState();
        });

      pollTimer = setInterval(updateLockState, 2500);
    })();

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (presenceChannel) {
        void presenceChannel.untrack();
        void supabase.removeChannel(presenceChannel);
      }
    };
  }, [slug, isAdmin, t.otherUser, t.user]);

  const dismissPresencePopup = () => {
    for (const id of liveOtherPresenceIdsRef.current) {
      acknowledgedPresenceIdsRef.current.add(id);
    }
    setPresencePopupOpen(false);
  };

  return (
    <>
      <SettingsClient
        settingsPresenceLocked={settingsPresenceLocked}
        settingsPresenceEditorName={settingsPresenceEditorName}
      />
      <PresencePopup
        open={presencePopupOpen && presencePopupNames.length > 0}
        message={t.presencePopup(formatConcurrentEditorNames(presencePopupNames, t))}
        okLabel={t.presencePopupOk}
        dir={dashboardDir(lang)}
        onDismiss={dismissPresencePopup}
      />
    </>
  );
}
