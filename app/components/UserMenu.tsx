"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

function initialsFromNameOrEmail(fullName: string, email: string): string {
  const name = fullName.trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] ?? "";
    const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
    return (a + b).toUpperCase() || "U";
  }
  const e = email.trim();
  if (!e) return "U";
  return (e[0] ?? "U").toUpperCase();
}

export default function UserMenu() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    void supabase.auth.getUser().then(({ data }) => {
      const u = data.user;
      setEmail(u?.email ?? "");
      const name =
        (typeof u?.user_metadata?.full_name === "string" ? u.user_metadata.full_name : "") ||
        (typeof u?.user_metadata?.name === "string" ? u.user_metadata.name : "");
      setFullName(String(name ?? ""));
    });
  }, [supabase]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const el = menuRef.current;
      const portalEl = portalRef.current;
      const btn = buttonRef.current;
      if (!btn) return;
      if (!(e.target instanceof Node)) return;
      const inside =
        (el && el.contains(e.target)) ||
        (portalEl && portalEl.contains(e.target)) ||
        btn.contains(e.target);
      if (!inside) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    function updatePos() {
      const btn = buttonRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const pad = 10;
      const preferredWidth = 256; // tailwind w-64
      const maxWidth = Math.max(180, window.innerWidth - pad * 2);
      const width = Math.min(preferredWidth, maxWidth);

      // Anchor to button "end" so it behaves correctly in RTL/LTR, then clamp to viewport.
      const anchorLeft = r.right - width;
      const left = Math.max(pad, Math.min(anchorLeft, window.innerWidth - width - pad));
      setPos({ top: r.bottom + 8, left, width });
    }
    updatePos();
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [open]);

  const initials = initialsFromNameOrEmail(fullName, email);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/dashboard/login");
  }

  return (
    <div className="relative z-[9999]" ref={menuRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={
          "h-9 w-9 rounded-full text-xs font-semibold flex items-center justify-center transition cursor-pointer select-none " +
          (open
            ? "text-white shadow-sm bg-[linear-gradient(135deg,#7133da,#ff92ff)]"
            : "border border-[rgba(113,51,218,0.18)] bg-white text-[#7133da] hover:bg-[#faf7ff]")
        }
        aria-haspopup="menu"
        aria-expanded={open}
        title={email || "User"}
      >
        {initials}
      </button>

      {open && pos
        ? createPortal(
            <div
              ref={portalRef}
              role="menu"
              style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width }}
              className="rounded-2xl border border-[rgba(113,51,218,0.14)] bg-white shadow-[0_18px_50px_rgba(113,51,218,0.18)] overflow-hidden z-[2147483647]"
            >
              <div className="px-4 py-3 bg-[linear-gradient(135deg,rgba(113,51,218,0.06),rgba(255,146,255,0.07))]">
                <p className="text-xs text-zinc-500 truncate">מחובר/ת כ</p>
                <p className="text-sm font-medium text-zinc-900 truncate">{email || "—"}</p>
              </div>
              <div className="h-px bg-[rgba(113,51,218,0.10)]" />
              <div className="py-1">
                <Link
                  role="menuitem"
                  href="/account/settings"
                  prefetch={true}
                  onClick={() => setOpen(false)}
                  className="block px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-[#faf7ff]"
                >
                  פרטים אישיים
                </Link>
                <Link
                  role="menuitem"
                  href="/account/billing"
                  prefetch={true}
                  onClick={() => setOpen(false)}
                  className="block px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-[#faf7ff]"
                >
                  חיוב וחבילות
                </Link>
                <Link
                  role="menuitem"
                  href="/account/notifications"
                  prefetch={true}
                  onClick={() => setOpen(false)}
                  className="block px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-[#faf7ff]"
                >
                  התראות
                </Link>
                <Link
                  role="menuitem"
                  href="/account/users"
                  prefetch={true}
                  onClick={() => setOpen(false)}
                  className="block px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-[#faf7ff]"
                >
                  משתמשים
                </Link>
                <Link
                  role="menuitem"
                  href="/account/contact"
                  prefetch={true}
                  onClick={() => setOpen(false)}
                  className="block px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-[#faf7ff]"
                >
                  צור קשר
                </Link>
              </div>
              <div className="h-px bg-[rgba(113,51,218,0.10)]" />
              <button
                role="menuitem"
                type="button"
                onClick={() => void signOut()}
                className="w-full text-right px-4 py-2 text-sm text-red-600 hover:bg-red-50 cursor-pointer"
              >
                התנתקות
              </button>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

