"use client";

import { SWRConfig } from "swr";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import posthog from "posthog-js";
import PwaServiceWorkerRegister from "@/app/components/PwaServiceWorkerRegister";

function shouldRecordSession(pathname: string): boolean {
  // Limit Session Replay to landing only.
  return pathname === "/" || pathname === "/landing";
}

function PostHogSessionReplayGate() {
  const pathname = usePathname() || "/";

  useEffect(() => {
    // Wizard init runs in instrumentation-client.ts. Here we only toggle recording.
    try {
      if (shouldRecordSession(pathname)) {
        posthog.startSessionRecording();
      } else {
        posthog.stopSessionRecording();
      }
    } catch {
      // Ignore if posthog wasn't initialized (missing key, adblock, etc.)
    }
  }, [pathname]);

  return null;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            retry: 1,
          },
        },
      })
  );

  return (
    <SWRConfig
      value={{
        revalidateOnFocus: true,
        dedupingInterval: 5000,
        shouldRetryOnError: false,
      }}
    >
      <QueryClientProvider client={queryClient}>
        <PwaServiceWorkerRegister />
        <PostHogSessionReplayGate />
        {children}
      </QueryClientProvider>
    </SWRConfig>
  );
}

