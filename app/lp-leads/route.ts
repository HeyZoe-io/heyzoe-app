import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import path from "path";

export const runtime = "nodejs";

export async function GET() {
  const html = readFileSync(path.join(process.cwd(), "public/lp-leads.html"), "utf-8");
  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

