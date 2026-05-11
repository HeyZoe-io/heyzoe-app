import { NextResponse, type NextRequest } from "next/server";
import {
  resolveAdminAllowedEmail,
  resolveSupabaseAnonKey,
  resolveSupabaseUrl,
} from "@/lib/server-env";

/** Relative return path `/...` optionally with `?query` — safe against `//` escapes. */
function safeReturnPath(req: NextRequest): string | null {
  const dest = `${req.nextUrl.pathname}${req.nextUrl.search}`;
  if (!dest.startsWith("/") || dest.startsWith("//")) return null;
  return dest;
}

function redirectToLogin(req: NextRequest) {
  const ret = safeReturnPath(req);
  const url = new URL("/admin/login", req.nextUrl.origin);
  if (ret) url.searchParams.set("next", ret);
  return NextResponse.redirect(url);
}

function redirectToDashboardLogin(req: NextRequest) {
  const ret = safeReturnPath(req);
  const url = new URL("/dashboard/login", req.nextUrl.origin);
  if (ret) url.searchParams.set("next", ret);
  return NextResponse.redirect(url);
}

function neutralNotFoundResponse() {
  return new NextResponse(
    `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>404</title></head><body style="margin:0;font-family:Arial,sans-serif;background:#fff;color:#18181b"><main style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center"><div><p style="margin:0;color:#a1a1aa;font-size:12px;font-weight:600;letter-spacing:.2em">404</p><h1 style="margin:16px 0 0;font-size:32px;line-height:1.2">העמוד לא נמצא</h1><p style="margin:12px 0 0;color:#71717a;font-size:14px;line-height:1.7">הכתובת שאליה ניסית להגיע אינה זמינה.</p></div></main></body></html>`,
    {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }
  );
}

function redirectToBillingReactivate(req: NextRequest) {
  const ret = safeReturnPath(req);
  const url = new URL("/account/billing", req.nextUrl.origin);
  url.searchParams.set("reactivate", "1");
  if (ret) url.searchParams.set("next", ret);
  return NextResponse.redirect(url);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Never run auth on APIs or Next internals — matcher below may overlap `/api/*` (e.g. webhooks).
  if (pathname.startsWith("/api") || pathname.startsWith("/_next")) {
    return NextResponse.next();
  }

  const lastSeg = pathname.split("/").filter(Boolean).pop() ?? "";
  const looksLikeStaticFile = /\.[a-z0-9]{1,16}$/i.test(lastSeg);
  if (looksLikeStaticFile) return NextResponse.next();

  // Public auth callback pages (Supabase redirects here)
  if (
    pathname === "/register/confirm" ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/onboarding") ||
    pathname.startsWith("/privacy") ||
    pathname.startsWith("/terms") ||
    pathname.startsWith("/lp-leads")
  ) {
    return NextResponse.next();
  }

  // Public slug-free entry points (matcher may invoke `/::slug`-style patterns above)
  if (pathname === "/") return NextResponse.next();

  if (pathname === "/dashboard/settings") return neutralNotFoundResponse();
  const isAdminPath = pathname.startsWith("/admin");
  const isOwnerDashboardPath = pathname.startsWith("/dashboard");
  const isOwnerAccountPath = pathname.startsWith("/account");
  // IMPORTANT: don't treat reserved prefixes (e.g. /account/settings) as business slugs.
  const isReservedPrefix =
    pathname.startsWith("/account") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/onboarding") ||
    pathname.startsWith("/register") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/lp-leads") ||
    pathname === "/" ||
    pathname === "/privacy" ||
    pathname === "/terms";
  const isSingleSegment = /^\/[^/]+\/?$/.test(pathname);
  const slugOnlyShortcut =
    isSingleSegment && !pathname.includes(".") && !isReservedPrefix;
  /** /my-studio/settings, /my-studio/analytics, etc. (+ optional `/my-studio` redirect root) */
  const isOwnerSlugPath =
    !isReservedPrefix &&
    (/^\/[^/]+\/(analytics|conversations|contacts|settings)\/?$/.test(pathname) || slugOnlyShortcut);
  const isDashboardSlugSettingsPath = /^\/dashboard\/[^/]+\/settings\/?$/.test(pathname);
  if (!isAdminPath && !isOwnerDashboardPath && !isOwnerAccountPath && !isOwnerSlugPath)
    return NextResponse.next();

  const res = NextResponse.next({ request: { headers: req.headers } });
  const cookies = req.cookies.getAll();
  const hasAuthCookie = cookies.some((c) => {
    const name = String(c.name || "");
    return (
      // Supabase SSR cookies are typically chunked and include auth-token.
      (name.startsWith("sb-") && name.includes("auth-token")) ||
      name === "supabase-auth-token" ||
      name === "sb-auth-token"
    );
  });

  if (isAdminPath) {
    const isLoginPath = pathname === "/admin/login";
    if (!hasAuthCookie) {
      if (isLoginPath) return res;
      return redirectToLogin(req);
    }

    // Admin gating by email requires resolving the authenticated user (network).
    // Keep this path-specific so we don't slow down dashboard traffic.
    const { createServerClient } = await import("@supabase/ssr");
    const supabase = createServerClient(resolveSupabaseUrl(), resolveSupabaseAnonKey(), {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            res.cookies.set(name, value, options);
          }
        },
      },
    });
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const allowedEmail = resolveAdminAllowedEmail();
    const userEmail = user?.email?.toLowerCase() || "";
    const isAllowed = userEmail === allowedEmail;

    if (!isAllowed) {
      if (isLoginPath) return res;
      return redirectToLogin(req);
    }

    if (isAllowed && isLoginPath) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin/dashboard";
      return NextResponse.redirect(url);
    }
    return res;
  }

  if (isOwnerDashboardPath || isOwnerAccountPath || isOwnerSlugPath) {
    const isLoginPath = pathname === "/dashboard/login";
    const isResetPath = pathname === "/dashboard/reset";
    if (!hasAuthCookie) {
      if (isLoginPath || isResetPath) return res;
      return redirectToDashboardLogin(req);
    }
    if (isLoginPath) {
      const next = req.nextUrl.searchParams.get("next");
      if (next && next.startsWith("/") && !next.startsWith("//")) {
        try {
          const target = new URL(next, req.nextUrl.origin);
          if (target.origin === req.nextUrl.origin) {
            return NextResponse.redirect(target);
          }
        } catch {
          /* ignore */
        }
      }
      return NextResponse.redirect(new URL("/dashboard", req.nextUrl.origin));
    }

    // Paywall for dashboard settings (edit-heavy area)
    if (isDashboardSlugSettingsPath) {
      const m = pathname.match(/^\/dashboard\/([^/]+)\/settings\/?$/);
      const slug = m?.[1] ?? "";
      if (slug) {
        // NOTE: intentionally no DB calls in middleware (avoid invocation timeouts).
      }
    }
  }

  return res;
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/dashboard/:path*",
    "/account/:path*",
    /*
     * Owner shortcuts under `app/[slug]/…` (/studio/analytics etc.).
     * `/api`, `/_next`, static files & marketing URLs are exited early inside middleware().
     */
    "/:slug",
    "/:slug/:path*",
  ],
};
