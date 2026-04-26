import type { ReactNode } from "react";
import { Fredoka, Heebo } from "next/font/google";

const fredoka = Fredoka({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const heebo = Heebo({ subsets: ["hebrew", "latin"], weight: ["400", "500", "600", "700"] });

export default function WelcomeLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={`${fredoka.className} ${heebo.className}`}
      dir="rtl"
      style={{ fontFamily: "'Fredoka', 'Heebo', system-ui, sans-serif" }}
    >
      {children}
    </div>
  );
}
