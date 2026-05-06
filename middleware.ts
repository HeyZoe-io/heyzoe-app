import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  resolveAdminAllowedEmail,
  resolveSupabaseAnonKey,
  resolveSupabaseUrl,
} from "@/lib/server-env";

function redirectToLogin(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/admin/login";
  url.searchParams.set("next", req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

function redirectToDashboardLogin(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/dashboard/login";
  url.searchParams.set("next", req.nextUrl.pathname);
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
  const url = req.nextUrl.clone();
  url.pathname = "/account/billing";
  url.searchParams.set("reactivate", "1");
  url.searchParams.set("next", req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Public auth callback pages (Supabase redirects here)
  if (pathname === "/register/confirm") return NextResponse.next();
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
  const isOwnerSlugPath =
    !isReservedPrefix && /^\/[^/]+\/(analytics|conversations|contacts|settings)\/?$/.test(pathname);
  const isDashboardSlugSettingsPath = /^\/dashboard\/[^/]+\/settings\/?$/.test(pathname);
  if (!isAdminPath && !isOwnerDashboardPath && !isOwnerAccountPath && !isOwnerSlugPath)
    return NextResponse.next();

  const res = NextResponse.next({ request: { headers: req.headers } });
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

  if (isAdminPath) {
    const allowedEmail = resolveAdminAllowedEmail();
    const userEmail = user?.email?.toLowerCase() || "";
    const isAllowed = userEmail === allowedEmail;
    const isLoginPath = pathname === "/admin/login";

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
    if (!user) {
      if (isLoginPath || isResetPath) return res;
      return redirectToDashboardLogin(req);
    }
    if (isLoginPath) {
      const url = req.nextUrl.clone();
      const next = req.nextUrl.searchParams.get("next");
      url.pathname = next && next.startsWith("/") ? next : "/dashboard";
      return NextResponse.redirect(url);
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
    "/:slug/analytics",
    "/:slug/conversations",
    "/:slug/contacts",
    "/:slug/settings",
  ],
};
