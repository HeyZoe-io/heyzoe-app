"use client";

import { SWRConfig } from "swr";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        revalidateOnFocus: true,
        dedupingInterval: 5000,
        shouldRetryOnError: false,
      }}
    >
      {children}
    </SWRConfig>
  );
}

