"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dashboardLangFromParam } from "@/lib/dashboard-lang";
import { dashboardSettingsT } from "@/lib/dashboard-settings-i18n";

export type UnsavedNavChoice = "save-and-go" | "leave" | "cancel";

export type SettingsUnsavedController = {
  hasUnsavedChanges: boolean;
  saveAll: () => Promise<boolean>;
  saving: boolean;
};

export type SettingsUnsavedContextValue = {
  hasUnsavedChanges: boolean;
  requestNavigation: ((target: string | (() => void)) => Promise<void>) | undefined;
};

export const SettingsUnsavedContext = createContext<SettingsUnsavedContextValue>({
  hasUnsavedChanges: false,
  requestNavigation: undefined,
});

const SettingsUnsavedRegisterContext = createContext<
  ((id: string, controller: SettingsUnsavedController | null) => void) | null
>(null);

export function useSettingsUnsaved(): SettingsUnsavedContextValue {
  return useContext(SettingsUnsavedContext);
}

/** Page registers save/dirty state; cleared on unmount. Extra surfaces use their own id. */
export function useRegisterSettingsUnsaved(
  controller: SettingsUnsavedController | null,
  id = "settings"
): void {
  const register = useContext(SettingsUnsavedRegisterContext);
  useEffect(() => {
    if (!register) return;
    register(id, controller);
  }, [register, controller, id]);
  useEffect(() => {
    if (!register) return;
    return () => register(id, null);
  }, [register, id]);
}

export function useSettingsGuardedLinkClick(): (
  e: MouseEvent<HTMLAnchorElement>,
  href: string
) => void {
  const { requestNavigation, hasUnsavedChanges } = useSettingsUnsaved();
  return useCallback(
    (e: MouseEvent<HTMLAnchorElement>, href: string) => {
      if (!requestNavigation || !hasUnsavedChanges) return;
      e.preventDefault();
      void requestNavigation(href);
    },
    [requestNavigation, hasUnsavedChanges]
  );
}

function UnsavedChangesDialog({
  open,
  saving,
  onResolve,
  t,
}: {
  open: boolean;
  saving: boolean;
  onResolve: (choice: UnsavedNavChoice) => void;
  t: ReturnType<typeof dashboardSettingsT>;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="w-full max-w-md rounded-2xl bg-white p-5 text-right shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-unsaved-dialog-title"
      >
        <p id="settings-unsaved-dialog-title" className="text-base font-semibold text-zinc-900">
          {t.unsavedTitle}
        </p>
        <p className="mt-2 text-sm text-zinc-600 leading-relaxed">{t.unsavedBody}</p>
        <div className="mt-6 flex flex-wrap justify-start gap-2">
          <Button
            type="button"
            disabled={saving}
            className="gap-2 rounded-2xl bg-[#7133da] px-5 hover:bg-[#5f2bc7]"
            onClick={() => onResolve("save-and-go")}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {t.unsavedSaveAndGo}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            className="rounded-2xl"
            onClick={() => onResolve("leave")}
          >
            {t.unsavedLeave}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            className="rounded-2xl"
            onClick={() => onResolve("cancel")}
          >
            {t.unsavedCancel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function SettingsUnsavedProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const lang = dashboardLangFromParam(searchParams.get("lang"));
  const t = dashboardSettingsT(lang);

  const [entries, setEntries] = useState<Record<string, SettingsUnsavedController>>({});
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const controllers = Object.values(entries);
  const hasUnsavedChanges = controllers.some((entry) => entry.hasUnsavedChanges);
  const saving = controllers.some((entry) => entry.saving);

  const [dialogOpen, setDialogOpen] = useState(false);
  const resolverRef = useRef<((choice: UnsavedNavChoice) => void) | null>(null);
  const navInFlightRef = useRef(false);

  const promptDialog = useCallback(() => {
    return new Promise<UnsavedNavChoice>((resolve) => {
      resolverRef.current = resolve;
      setDialogOpen(true);
    });
  }, []);

  const resolveDialog = useCallback((choice: UnsavedNavChoice) => {
    setDialogOpen(false);
    resolverRef.current?.(choice);
    resolverRef.current = null;
  }, []);

  useEffect(() => {
    if (!dialogOpen) return;
    if (!hasUnsavedChanges) {
      setDialogOpen(false);
      resolverRef.current?.("cancel");
      resolverRef.current = null;
    }
  }, [dialogOpen, hasUnsavedChanges]);

  const allowHistoryLeaveRef = useRef(false);

  const requestNavigation = useCallback(
    async (target: string | (() => void)) => {
      const navigate = () => {
        if (typeof target === "function") {
          target();
          return;
        }
        router.push(target);
      };

      const dirty = Object.values(entriesRef.current).filter((entry) => entry.hasUnsavedChanges);
      if (!dirty.length) {
        navigate();
        return;
      }

      if (navInFlightRef.current) return;
      navInFlightRef.current = true;
      try {
        const choice = await promptDialog();
        if (choice === "cancel") return;
        if (choice === "save-and-go") {
          for (const entry of dirty) {
            const ok = await entry.saveAll();
            if (!ok) return;
          }
        }
        navigate();
      } finally {
        navInFlightRef.current = false;
      }
    },
    [router, promptDialog]
  );

  const requestNavigationRef = useRef(requestNavigation);
  requestNavigationRef.current = requestNavigation;

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const guardedHref = window.location.href;
    const previous = window.history.state;
    window.history.pushState(
      { ...(previous && typeof previous === "object" ? previous : {}), hzSettingsGuard: 1 },
      "",
      guardedHref
    );
    const onPop = () => {
      if (allowHistoryLeaveRef.current) {
        allowHistoryLeaveRef.current = false;
        return;
      }
      const dirty = Object.values(entriesRef.current).some((entry) => entry.hasUnsavedChanges);
      if (!dirty) return;
      window.history.pushState({ hzSettingsGuard: 1 }, "", guardedHref);
      void requestNavigationRef.current(() => {
        allowHistoryLeaveRef.current = true;
        window.history.go(-2);
      });
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      const state = window.history.state as { hzSettingsGuard?: number } | null;
      if (state?.hzSettingsGuard) {
        const { hzSettingsGuard: _guard, ...rest } = state;
        void _guard;
        window.history.replaceState(rest, "", window.location.href);
      }
    };
  }, [hasUnsavedChanges]);

  const register = useCallback((id: string, next: SettingsUnsavedController | null) => {
    setEntries((prev) => {
      if (!next) {
        if (!(id in prev)) return prev;
        const copy = { ...prev };
        delete copy[id];
        return copy;
      }
      const current = prev[id];
      if (
        current &&
        current.hasUnsavedChanges === next.hasUnsavedChanges &&
        current.saving === next.saving &&
        current.saveAll === next.saveAll
      ) {
        return prev;
      }
      return { ...prev, [id]: next };
    });
  }, []);

  const contextValue = useMemo<SettingsUnsavedContextValue>(
    () => ({
      hasUnsavedChanges,
      requestNavigation,
    }),
    [hasUnsavedChanges, requestNavigation]
  );

  return (
    <SettingsUnsavedRegisterContext.Provider value={register}>
      <SettingsUnsavedContext.Provider value={contextValue}>
        {children}
        <UnsavedChangesDialog
          open={dialogOpen}
          saving={saving}
          onResolve={resolveDialog}
          t={t}
        />
      </SettingsUnsavedContext.Provider>
    </SettingsUnsavedRegisterContext.Provider>
  );
}
