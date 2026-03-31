"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const initials = initialsFromNameOrEmail(fullName, email);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/dashboard/login");
  }

  return (
    <div className="relative z-[9999]" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-9 w-9 rounded-full border border-zinc-200 bg-white text-zinc-800 text-xs font-semibold flex items-center justify-center hover:bg-zinc-50 transition cursor-pointer select-none"
        aria-haspopup="menu"
        aria-expanded={open}
        title={email || "User"}
      >
        {initials}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute left-0 mt-2 w-64 rounded-2xl border border-zinc-200 bg-white shadow-xl overflow-hidden z-[10000]"
        >
          <div className="px-4 py-3">
            <p className="text-xs text-zinc-500 truncate">מחובר/ת כ</p>
            <p className="text-sm font-medium text-zinc-900 truncate">{email || "—"}</p>
          </div>
          <div className="h-px bg-zinc-100" />
          <div className="py-1">
            <Link
              role="menuitem"
              href="/account/settings"
              onClick={() => setOpen(false)}
              className="block px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              הגדרות חשבון
            </Link>
            <Link
              role="menuitem"
              href="/account/billing"
              onClick={() => setOpen(false)}
              className="block px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              חיוב וחבילות
            </Link>
            <Link
              role="menuitem"
              href="/account/contact"
              onClick={() => setOpen(false)}
              className="block px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              צור קשר
            </Link>
          </div>
          <div className="h-px bg-zinc-100" />
          <button
            role="menuitem"
            type="button"
            onClick={() => void signOut()}
            className="w-full text-right px-4 py-2 text-sm text-red-600 hover:bg-red-50 cursor-pointer"
          >
            התנתקות
          </button>
        </div>
      ) : null}
    </div>
  );
}

