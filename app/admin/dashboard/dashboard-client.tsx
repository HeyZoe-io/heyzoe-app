"use client";

import { type FormEvent, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Activity, AlertTriangle, BarChart3, CalendarDays, CircleDollarSign, Users } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, FunnelChart, Funnel, LabelList, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type DashboardPayload = {
  range: { from: string; to: string };
  errors: { messagesError: string | null; conversionsError: string | null };
  kpis: { dailyActiveConversations: number; monthlyActiveConversations: number; annualActiveConversations: number };
  funnel: { visitors: number; engaged: number; clickedCta: number; conversionRate: number };
  businessOverview: Array<{ slug: string; plan: "basic" | "premium"; active: boolean; seniorityDays: number; firstAt: string; lastAt: string; sessions: number }>;
  dropoffByMessageNumber: Array<{ step: string; count: number }>;
  dropoffByIntent: Array<{ intent: string; count: number }>;
  errorLogs: Array<{ at: string; slug: string; code: string; content: string }>;
  modelUsageDistribution: Array<{ model: string; count: number; percent: number }>;
};

export default function DashboardClient({ data }: { data: DashboardPayload }) {
  const router = useRouter();
  const search = useSearchParams();
  const [planBySlug, setPlanBySlug] = useState<Record<string, "basic" | "premium">>(() => {
    const rec: Record<string, "basic" | "premium"> = {};
    data.businessOverview.forEach((b) => {
      rec[b.slug] = b.plan === "premium" ? "premium" : "basic";
    });
    return rec;
  });
  const [savingSlug, setSavingSlug] = useState<string | null>(null);

  const funnelData = useMemo(
    () => [
      { value: data.funnel.visitors, name: "Visitors", fill: "#c084fc" },
      { value: data.funnel.engaged, name: "Engaged >2 msgs", fill: "#a855f7" },
      { value: data.funnel.clickedCta, name: "Clicked CTA", fill: "#7e22ce" },
    ],
    [data.funnel]
  );

  async function updatePlan(slug: string, plan: "basic" | "premium") {
    setSavingSlug(slug);
    setPlanBySlug((prev) => ({ ...prev, [slug]: plan }));
    try {
      const res = await fetch("/api/admin/businesses/plan", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, plan }),
      });
      if (!res.ok) {
        setPlanBySlug((prev) => ({ ...prev, [slug]: data.businessOverview.find((b) => b.slug === slug)?.plan ?? "basic" }));
      }
    } finally {
      setSavingSlug(null);
    }
  }

  function applyDateFilter(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const params = new URLSearchParams(search.toString());
    const from = String(form.get("from") || "");
    const to = String(form.get("to") || "");
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    router.push(`/admin/dashboard?${params.toString()}`);
  }

  return (
    <main className="min-h-screen bg-zinc-50 p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-900">Zoe Admin Dashboard</h1>
            <p className="text-sm text-zinc-500">Multi-tenant analytics, conversions, and model health</p>
          </div>
          <form onSubmit={applyDateFilter} className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="text-xs text-zinc-500">From</label>
              <Input name="from" type="date" defaultValue={data.range.from} />
            </div>
            <div>
              <label className="text-xs text-zinc-500">To</label>
              <Input name="to" type="date" defaultValue={data.range.to} />
            </div>
            <Button type="submit"><CalendarDays className="h-4 w-4" /> Apply</Button>
          </form>
        </div>

        <section className="grid gap-4 md:grid-cols-3">
          <Card><CardHeader><CardDescription><Users className="inline h-4 w-4 mr-1" />Daily Active Conversations</CardDescription><CardTitle>{data.kpis.dailyActiveConversations}</CardTitle></CardHeader></Card>
          <Card><CardHeader><CardDescription><CircleDollarSign className="inline h-4 w-4 mr-1" />Monthly Active Conversations</CardDescription><CardTitle>{data.kpis.monthlyActiveConversations}</CardTitle></CardHeader></Card>
          <Card><CardHeader><CardDescription><BarChart3 className="inline h-4 w-4 mr-1" />Annual Active Conversations</CardDescription><CardTitle>{data.kpis.annualActiveConversations}</CardTitle></CardHeader></Card>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Zoe Conversion Funnel</CardTitle>
              <CardDescription>Visitors → Engaged → CTA Clicked ({data.funnel.conversionRate}% conversion)</CardDescription>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <FunnelChart>
                  <Tooltip />
                  <Funnel dataKey="value" data={funnelData} isAnimationActive>
                    <LabelList position="right" fill="#52525b" stroke="none" dataKey="name" />
                  </Funnel>
                </FunnelChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Model Usage Distribution</CardTitle>
              <CardDescription>Traffic share by model</CardDescription>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.modelUsageDistribution} dataKey="count" nameKey="model" outerRadius={95}>
                    {data.modelUsageDistribution.map((_, idx) => (
                      <Cell key={idx} fill={["#c084fc", "#a855f7", "#6d28d9", "#4c1d95"][idx % 4]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-zinc-600">
                {data.modelUsageDistribution.map((x) => (
                  <div key={x.model} className="flex items-center justify-between">
                    <span>{x.model}</span>
                    <span>{x.percent}%</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Drop-off by Message Number</CardTitle>
              <CardDescription>Where users stop after N user messages</CardDescription>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.dropoffByMessageNumber}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="step" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="count" fill="#a855f7" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Drop-off by Intent</CardTitle>
              <CardDescription>Which intent precedes silence most often</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.dropoffByIntent.map((x) => (
                <div key={x.intent} className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2">
                  <span className="text-sm text-zinc-700">{x.intent}</span>
                  <Badge className="border-zinc-300 text-zinc-700">{x.count}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle><Activity className="inline h-4 w-4 mr-1" />Business Overview</CardTitle>
              <CardDescription>Active status and seniority by slug</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 max-h-[380px] overflow-auto">
              {data.businessOverview.map((b) => (
                <div key={b.slug} className="rounded-lg border border-zinc-200 p-3">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{b.slug}</p>
                    <Badge className={b.active ? "border-emerald-300 text-emerald-700" : "border-zinc-300 text-zinc-500"}>
                      {b.active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <p className="text-xs text-zinc-500">Seniority: {b.seniorityDays} days · Sessions: {b.sessions}</p>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-zinc-500">Plan</span>
                      <select
                        value={planBySlug[b.slug] ?? "basic"}
                        disabled={savingSlug === b.slug}
                        onChange={(e) => updatePlan(b.slug, e.target.value === "premium" ? "premium" : "basic")}
                        className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
                      >
                        <option value="basic">basic</option>
                        <option value="premium">premium</option>
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle><AlertTriangle className="inline h-4 w-4 mr-1" />System Health</CardTitle>
              <CardDescription>Last 10 logged errors (429/503)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 max-h-[380px] overflow-auto">
              {data.errorLogs.length === 0 ? (
                <p className="text-sm text-zinc-500">No recent 429/503 errors in this range.</p>
              ) : data.errorLogs.map((e, i) => (
                <div key={`${e.at}-${i}`} className="rounded-lg border border-zinc-200 p-3">
                  <div className="flex items-center justify-between text-xs text-zinc-500">
                    <span>{new Date(e.at).toLocaleString()}</span>
                    <Badge className="border-amber-300 text-amber-700">{e.code}</Badge>
                  </div>
                  <p className="text-sm mt-1">{e.slug}</p>
                  <p className="text-xs text-zinc-500">{e.content}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        {(data.errors.messagesError || data.errors.conversionsError) && (
          <Card>
            <CardHeader>
              <CardTitle>Data Source Warnings</CardTitle>
              <CardDescription>Database query warnings from Supabase</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-amber-700 space-y-1">
              {data.errors.messagesError && <p>messages: {data.errors.messagesError}</p>}
              {data.errors.conversionsError && <p>conversions: {data.errors.conversionsError}</p>}
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
