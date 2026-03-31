import type { ReactNode } from "react";
import DashboardPwaPrompt from "@/app/components/DashboardPwaPrompt";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <DashboardPwaPrompt />
    </>
  );
}

