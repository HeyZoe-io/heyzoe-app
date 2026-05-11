"use client";

import nextDynamic from "next/dynamic";

export default nextDynamic(() => import("./MarketingFlowTab").then((m) => m.default), { ssr: false });
