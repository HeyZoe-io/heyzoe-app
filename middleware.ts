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
  if (!isAdminPath && !isOwnerDashboardPath) return NextResponse.next();

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

  if (isOwnerDashboardPath) {
    const isLoginPath = pathname === "/dashboard/login";
    if (!user) {
      if (isLoginPath) return res;
      return redirectToDashboardLogin(req);
    }
    if (isLoginPath) {
      const url = req.nextUrl.clone();
      url.pathname = "/dashboard/settings";
      return NextResponse.redirect(url);
    }
  }

  return res;
}

export const config = {
  matcher: ["/admin/:path*", "/dashboard/:path*"],
};
