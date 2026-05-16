import Link from "next/link";
import type { CSSProperties } from "react";

export type AdminNavTab =
  | "dashboard"
  | "zoe"
  | "marketing"
  | "analytics"
  | "businesses"
  | "cancellations"
  | "requests";

const TABS: { key: AdminNavTab; href: string; label: string }[] = [
  { key: "dashboard", href: "/admin/dashboard", label: "ראשי" },
  { key: "zoe", href: "/admin/zoe", label: "זואי" },
  { key: "marketing", href: "/admin/dashboard?tab=marketing", label: "פלואו שיווקי" },
  { key: "analytics", href: "/admin/analytics", label: "analytics" },
  { key: "businesses", href: "/admin/businesses", label: "עסקים" },
  { key: "cancellations", href: "/admin/cancellations", label: "ביטולים" },
  { key: "requests", href: "/admin/requests", label: "פניות מבעלי עסקים" },
];

const pillBase: CSSProperties = {
  display: "inline-block",
  padding: "8px 12px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 400,
  textDecoration: "none",
  border: "1px solid rgba(113,51,218,0.18)",
};

export function AdminNav({ active }: { active: AdminNavTab }) {
  return (
    <nav style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-start" }}>
      {TABS.map((tab) => {
        const isActive = active === tab.key;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            prefetch
            style={{
              ...pillBase,
              background: isActive ? "#7133da" : "white",
              color: isActive ? "white" : "#7133da",
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
