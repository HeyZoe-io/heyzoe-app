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

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isAdminPath = pathname.startsWith("/admin");
  const isOwnerDashboardPath = pathname.startsWith("/dashboard");
  const isOwnerAccountPath = pathname.startsWith("/account");
  const isOwnerSlugPath =
    /^\/[^/]+\/(analytics|conversations|settings)\/?$/.test(pathname);
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
    if (!user) {
      if (isLoginPath) return res;
      return redirectToDashboardLogin(req);
    }
    if (isLoginPath) {
      const url = req.nextUrl.clone();
      const next = req.nextUrl.searchParams.get("next");
      url.pathname = next && next.startsWith("/") ? next : "/dashboard/settings";
      return NextResponse.redirect(url);
    }

    // Role gating: employees can access conversations only
    if (isOwnerSlugPath) {
      const m = pathname.match(/^\/([^/]+)\/(analytics|conversations|settings)\/?$/);
      const slug = m?.[1] ?? "";
      const section = m?.[2] ?? "";
      if (slug && section && section !== "conversations") {
        try {
          const { data: biz } = await supabase
            .from("businesses")
            .select("id, user_id")
            .eq("slug", slug)
            .maybeSingle();
          const isOwner = biz?.user_id && String(biz.user_id) === user.id;
          if (!isOwner && biz?.id) {
            const { data: bu } = await supabase
              .from("business_users")
              .select("role")
              .eq("business_id", biz.id)
              .eq("user_id", user.id)
              .maybeSingle();
            const isAdminMember = bu?.role === "admin";
            if (!isAdminMember) {
              const url = req.nextUrl.clone();
              url.pathname = `/${slug}/conversations`;
              return NextResponse.redirect(url);
            }
          }
        } catch {
          // If we can't check role here, let page-level auth handle it.
        }
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
    "/:slug/settings",
  ],
};
