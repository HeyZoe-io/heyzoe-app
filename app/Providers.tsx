"use client";

import { SWRConfig } from "swr";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

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
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </SWRConfig>
  );
}

