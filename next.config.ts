import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** מונע מ-Turbopack לבחור את שורש ה-workspace ההורי (יש שם package-lock נפרד). */
const appRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: appRoot,
  },
};

export default nextConfig;
