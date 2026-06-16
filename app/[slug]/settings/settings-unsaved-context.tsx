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
  ((controller: SettingsUnsavedController | null) => void) | null
>(null);

export function useSettingsUnsaved(): SettingsUnsavedContextValue {
  return useContext(SettingsUnsavedContext);
}

/** Page registers save/dirty state; cleared on unmount. */
export function useRegisterSettingsUnsaved(controller: SettingsUnsavedController | null): void {
  const register = useContext(SettingsUnsavedRegisterContext);
  useEffect(() => {
    if (!register) return;
    register(controller);
    return () => register(null);
  }, [register, controller]);
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

  const [controller, setController] = useState<SettingsUnsavedController | null>(null);
  const controllerRef = useRef<SettingsUnsavedController | null>(null);
  controllerRef.current = controller;

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
    if (!controller?.hasUnsavedChanges) {
      setDialogOpen(false);
      resolverRef.current?.("cancel");
      resolverRef.current = null;
    }
  }, [dialogOpen, controller?.hasUnsavedChanges]);

  const requestNavigation = useCallback(
    async (target: string | (() => void)) => {
      const navigate = () => {
        if (typeof target === "function") {
          target();
          return;
        }
        router.push(target);
      };

      const ctrl = controllerRef.current;
      if (!ctrl?.hasUnsavedChanges) {
        navigate();
        return;
      }

      if (navInFlightRef.current) return;
      navInFlightRef.current = true;
      try {
        const choice = await promptDialog();
        if (choice === "cancel") return;
        if (choice === "save-and-go") {
          const ok = await ctrl.saveAll();
          if (!ok) return;
        }
        navigate();
      } finally {
        navInFlightRef.current = false;
      }
    },
    [router, promptDialog]
  );

  const register = useCallback((next: SettingsUnsavedController | null) => {
    setController(next);
  }, []);

  const contextValue = useMemo<SettingsUnsavedContextValue>(
    () => ({
      hasUnsavedChanges: controller?.hasUnsavedChanges ?? false,
      requestNavigation,
    }),
    [controller?.hasUnsavedChanges, requestNavigation]
  );

  return (
    <SettingsUnsavedRegisterContext.Provider value={register}>
      <SettingsUnsavedContext.Provider value={contextValue}>
        {children}
        <UnsavedChangesDialog
          open={dialogOpen}
          saving={controller?.saving ?? false}
          onResolve={resolveDialog}
          t={t}
        />
      </SettingsUnsavedContext.Provider>
    </SettingsUnsavedRegisterContext.Provider>
  );
}
