"use client";

import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  ReactFlowProvider,
  useReactFlow,
  MarkerType,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

const PURPLE = "#7133da";
const GREEN = "#35ff70";
const BG = "#f5f3ff";

type FlowKind = "message" | "question" | "media" | "cta" | "followup";

export type MfNodeData = {
  flowType: FlowKind;
  text?: string;
  buttons?: string[];
  mediaUrl?: string;
  mediaKind?: "image" | "video";
  caption?: string;
  url?: string;
  delayMinutes?: number;
  isStart?: boolean;
};

function nodeShell(
  title: string,
  children: React.ReactNode,
  style: React.CSSProperties,
  handles: React.ReactNode
) {
  return (
    <div
      dir="rtl"
      style={{
        borderRadius: 16,
        padding: "10px 12px",
        minWidth: 160,
        maxWidth: 220,
        fontFamily: "Fredoka, Heebo, system-ui, sans-serif",
        fontSize: 13,
        ...style,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: PURPLE }} />
      <div style={{ fontSize: 11, fontWeight: 600, color: "#6b5b9a", marginBottom: 4 }}>{title}</div>
      {children}
      {handles}
    </div>
  );
}

function MfMessageNode({ data, selected }: NodeProps<Node<MfNodeData>>) {
  return nodeShell(
    "הודעה",
    <div style={{ color: "#1a0a3c", whiteSpace: "pre-wrap", lineHeight: 1.35 }}>{data.text || "…"}</div>,
    {
      background: "white",
      border: `2px solid ${selected ? GREEN : "rgba(113,51,218,0.35)"}`,
      boxShadow: selected ? `0 0 0 2px ${GREEN}` : undefined,
    },
    <Handle type="source" position={Position.Bottom} id="next" style={{ background: PURPLE }} />
  );
}

function MfQuestionNode({ data, selected }: NodeProps<Node<MfNodeData>>) {
  const buttons = (data.buttons?.length ? data.buttons : ["אפשרות 1", "אפשרות 2"]).slice(0, 3);
  return nodeShell(
    "שאלה",
    <>
      <div style={{ color: "#1a0a3c", marginBottom: 8, whiteSpace: "pre-wrap" }}>{data.text || "…"}</div>
      <ul style={{ margin: 0, paddingInlineStart: 18, color: "#513a86", fontSize: 12 }}>
        {buttons.map((b, i) => (
          <li key={i}>{b || `כפתור ${i + 1}`}</li>
        ))}
      </ul>
    </>,
    {
      background: "rgba(113,51,218,0.12)",
      border: `2px solid ${selected ? GREEN : "rgba(113,51,218,0.45)"}`,
    },
    <>
      {buttons.map((_, i) => (
        <Handle
          key={i}
          type="source"
          position={Position.Right}
          id={`btn-${i}`}
          style={{
            top: 56 + i * 22,
            background: PURPLE,
            width: 10,
            height: 10,
            border: "2px solid white",
          }}
        />
      ))}
    </>
  );
}

function MfMediaNode({ data, selected }: NodeProps<Node<MfNodeData>>) {
  const kind = data.mediaKind === "video" ? "וידאו" : "תמונה";
  return nodeShell(
    "מדיה",
    <>
      <div style={{ fontSize: 12, color: "#0f5132", marginBottom: 4 }}>{kind}</div>
      <div style={{ color: "#1a0a3c", fontSize: 12, wordBreak: "break-all" }}>{data.mediaUrl || "—"}</div>
      {data.caption ? (
        <div style={{ marginTop: 6, fontSize: 12, color: "#374151" }}>{data.caption}</div>
      ) : null}
    </>,
    {
      background: "rgba(53,255,112,0.18)",
      border: `2px solid ${selected ? PURPLE : "rgba(53,255,112,0.55)"}`,
    },
    <Handle type="source" position={Position.Bottom} id="next" style={{ background: PURPLE }} />
  );
}

function MfCtaNode({ data, selected }: NodeProps<Node<MfNodeData>>) {
  return nodeShell(
    "הנעה לפעולה",
    <>
      <div style={{ color: "#1a0a3c", marginBottom: 6 }}>{data.text || "…"}</div>
      <div style={{ fontSize: 11, color: "#6b5b9a", wordBreak: "break-all" }}>{data.url || ""}</div>
    </>,
    {
      background: "linear-gradient(135deg, rgba(113,51,218,0.2), rgba(255,146,255,0.25))",
      border: `2px solid ${selected ? GREEN : "rgba(113,51,218,0.4)"}`,
    },
    <Handle type="source" position={Position.Bottom} id="next" style={{ background: PURPLE }} />
  );
}

function MfFollowupNode({ data, selected }: NodeProps<Node<MfNodeData>>) {
  const m = data.delayMinutes ?? 20;
  return nodeShell(
    "פולואפ",
    <>
      <div style={{ color: "#374151", marginBottom: 6 }}>{data.text || "…"}</div>
      <div style={{ fontSize: 12, color: "#6b7280" }}>אחרי {m} דק׳</div>
    </>,
    {
      background: "rgba(243,244,246,0.95)",
      border: `2px solid ${selected ? PURPLE : "#d1d5db"}`,
    },
    <Handle type="source" position={Position.Bottom} id="next" style={{ background: PURPLE }} />
  );
}

const nodeTypes = {
  mfMessage: MfMessageNode,
  mfQuestion: MfQuestionNode,
  mfMedia: MfMediaNode,
  mfCta: MfCtaNode,
  mfFollowup: MfFollowupNode,
};

function flowTypeToRfType(t: FlowKind): keyof typeof nodeTypes {
  const m: Record<FlowKind, keyof typeof nodeTypes> = {
    message: "mfMessage",
    question: "mfQuestion",
    media: "mfMedia",
    cta: "mfCta",
    followup: "mfFollowup",
  };
  return m[t] || "mfMessage";
}

function FlowCanvas() {
  const rf = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flowActive, setFlowActive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const selected = useMemo(() => nodes.find((n) => n.id === selectedId) ?? null, [nodes, selectedId]);

  const load = useCallback(async () => {
    setLoadErr(null);
    try {
      const res = await fetch("/api/admin/marketing/flow", { cache: "no-store" });
      if (!res.ok) {
        setLoadErr("טעינה נכשלה");
        return;
      }
      const j = await res.json();
      setFlowActive(Boolean(j.settings?.is_active));

      const dbNodes = (j.nodes ?? []) as Array<{
        id: number;
        type: string;
        data: Record<string, unknown>;
        position_x: number;
        position_y: number;
        is_start?: boolean;
      }>;
      const dbEdges = (j.edges ?? []) as Array<{
        id: number;
        source_node_id: number;
        target_node_id: number;
        label: string;
      }>;

      const n: Node[] = dbNodes.map((row) => {
        const flowType = (String(row.type) as FlowKind) || "message";
        const d = { ...(row.data || {}) } as MfNodeData;
        d.flowType = flowType;
        d.isStart = Boolean(row.is_start);
        if (flowType === "question" && (!d.buttons || !d.buttons.length)) {
          const outs = dbEdges.filter((e) => e.source_node_id === row.id).sort((a, b) => a.id - b.id);
          d.buttons = outs.map((e) => e.label || "כפתור").slice(0, 3);
          if (!d.buttons.length) d.buttons = ["אפשרות 1", "אפשרות 2"];
        }
        return {
          id: String(row.id),
          type: flowTypeToRfType(flowType),
          position: { x: row.position_x, y: row.position_y },
          data: d,
        };
      });

      const e: Edge[] = dbEdges.map((row) => {
        const src = dbNodes.find((x) => x.id === row.source_node_id);
        let sourceHandle: string | undefined;
        if (src?.type === "question") {
          const outs = dbEdges.filter((x) => x.source_node_id === src.id).sort((a, b) => a.id - b.id);
          const idx = outs.findIndex((x) => x.id === row.id);
          if (idx >= 0) sourceHandle = `btn-${idx}`;
        } else {
          sourceHandle = "next";
        }
        return {
          id: `e-${row.id}`,
          source: String(row.source_node_id),
          target: String(row.target_node_id),
          sourceHandle,
          label: row.label || "",
          markerEnd: { type: MarkerType.ArrowClosed, color: PURPLE },
        };
      });

      setNodes(n);
      setEdges(e);
      setSelectedId((sid) => (n.length ? (n.some((x) => x.id === sid) ? sid : n[0]!.id) : null));
    } catch {
      setLoadErr("שגיאת רשת");
    }
  }, [setEdges, setNodes]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- טעינה ראשונית בלבד
  }, []);

  const onConnect = useCallback(
    (p: Connection) => {
      const src = rf.getNode(p.source!);
      let label = "";
      if (src?.type === "mfQuestion" && p.sourceHandle?.startsWith("btn-")) {
        const i = Number(p.sourceHandle.replace("btn-", ""));
        const btns = ((src.data as MfNodeData).buttons ?? []).slice(0, 3);
        label = btns[i] ?? `כפתור ${i + 1}`;
      } else if (src?.type === "mfFollowup") {
        const dm = (src.data as MfNodeData).delayMinutes ?? 20;
        label = `אחרי ${dm} דק׳`;
      }
      setEdges((eds) =>
        addEdge(
          {
            ...p,
            id: `e-tmp-${Date.now()}`,
            label,
            markerEnd: { type: MarkerType.ArrowClosed, color: PURPLE },
          },
          eds
        )
      );
    },
    [rf, setEdges]
  );

  const addNode = (flowType: FlowKind) => {
    const id = `tmp-${crypto.randomUUID()}`;
    const pos = { x: 80 + Math.random() * 120, y: 60 + nodes.length * 28 };
    const base: MfNodeData = {
      flowType,
      text: "",
      isStart: nodes.length === 0,
      buttons: flowType === "question" ? ["כן", "לא"] : undefined,
      delayMinutes: flowType === "followup" ? 20 : undefined,
      mediaKind: flowType === "media" ? "image" : undefined,
    };
    setNodes((nds) => [
      ...nds.map((n) =>
        flowType !== "question" && base.isStart ? { ...n, data: { ...(n.data as MfNodeData), isStart: false } } : n
      ),
      { id, type: flowTypeToRfType(flowType), position: pos, data: base },
    ]);
    setSelectedId(id);
    setAddOpen(false);
  };

  const updateSelectedData = (patch: Partial<MfNodeData>) => {
    if (!selectedId) return;
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== selectedId) return n;
        const d = { ...(n.data as MfNodeData), ...patch };
        return { ...n, data: d };
      })
    );
  };

  const setAsStartOnly = () => {
    if (!selectedId) return;
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: { ...(n.data as MfNodeData), isStart: n.id === selectedId },
      }))
    );
  };

  const addQuestionButton = () => {
    const d = selected?.data as MfNodeData | undefined;
    if (!d || d.flowType !== "question") return;
    const b = [...(d.buttons ?? [])];
    if (b.length >= 3) return;
    b.push(`כפתור ${b.length + 1}`);
    updateSelectedData({ buttons: b });
  };

  const removeQuestionButton = (idx: number) => {
    const d = selected?.data as MfNodeData | undefined;
    if (!d || d.flowType !== "question") return;
    const b = [...(d.buttons ?? [])];
    b.splice(idx, 1);
    updateSelectedData({ buttons: b.length ? b : ["אפשרות 1"] });
    setEdges((eds) => eds.filter((e) => !(e.source === selectedId && e.sourceHandle === `btn-${idx}`)));
  };

  const save = async () => {
    setSaving(true);
    try {
      const ordered = [...nodes];
      const nodePayload = ordered.map((n) => {
        const raw = n.data as MfNodeData;
        const { flowType: _ft, isStart: _is, ...rest } = raw;
        return {
          type: raw.flowType,
          data: {
            text: rest.text,
            buttons: rest.buttons,
            mediaUrl: rest.mediaUrl,
            mediaKind: rest.mediaKind,
            caption: rest.caption,
            url: rest.url,
            delayMinutes: rest.delayMinutes,
          },
          position: n.position,
          is_start: Boolean(raw.isStart),
        };
      });
      const edgePayload = edges
        .map((e) => {
          const fromIndex = ordered.findIndex((n) => n.id === e.source);
          const toIndex = ordered.findIndex((n) => n.id === e.target);
          if (fromIndex < 0 || toIndex < 0) return null;
          return {
            fromIndex,
            toIndex,
            label: String(e.label ?? ""),
          };
        })
        .filter(Boolean);
      const ri0 = ordered.findIndex((n) => (n.data as MfNodeData).isStart);
      const rootIndex = ri0 >= 0 ? ri0 : 0;
      const res = await fetch("/api/admin/marketing/flow/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodes: nodePayload,
          edges: edgePayload,
          rootIndex: rootIndex >= 0 ? rootIndex : 0,
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        alert(`שמירה נכשלה: ${t}`);
        return;
      }
      await load();
    } finally {
      setSaving(false);
    }
  };

  const toggleFlow = async () => {
    const next = !flowActive;
    const res = await fetch("/api/admin/marketing/flow", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: next }),
    });
    if (res.ok) setFlowActive(next);
  };

  const uploadMedia = async (file: File) => {
    const fd = new FormData();
    fd.set("file", file);
    const res = await fetch("/api/admin/marketing/upload", { method: "POST", body: fd });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(j.error || "העלאה נכשלה");
      return;
    }
    if (j.url) updateSelectedData({ mediaUrl: j.url });
  };

  const pill =
    "inline-flex items-center justify-center rounded-full px-3 py-1.5 text-sm font-medium border transition";

  return (
    <div dir="rtl" style={{ fontFamily: "Fredoka, Heebo, system-ui, sans-serif", color: "#1a0a3c" }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
          marginBottom: 14,
          padding: "12px 14px",
          background: "rgba(255,255,255,0.85)",
          borderRadius: 16,
          border: "1px solid rgba(113,51,218,0.18)",
        }}
      >
        <div style={{ position: "relative" }}>
          <button
            type="button"
            className={pill}
            style={{ background: PURPLE, color: "white", borderColor: "transparent" }}
            onClick={() => setAddOpen((o) => !o)}
          >
            הוסף נוד ▾
          </button>
          {addOpen ? (
            <div
              style={{
                position: "absolute",
                top: "100%",
                right: 0,
                marginTop: 6,
                background: "white",
                borderRadius: 12,
                border: "1px solid rgba(113,51,218,0.2)",
                boxShadow: "0 12px 40px rgba(113,51,218,0.12)",
                zIndex: 20,
                minWidth: 180,
              }}
            >
              {(
                [
                  ["message", "הודעה"],
                  ["question", "שאלה"],
                  ["media", "מדיה"],
                  ["cta", "הנעה לפעולה"],
                  ["followup", "פולואפ"],
                ] as const
              ).map(([t, lab]) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => addNode(t)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "right",
                    padding: "10px 14px",
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    fontSize: 14,
                  }}
                >
                  {lab}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className={pill}
          style={{ background: "white", color: PURPLE, borderColor: "rgba(113,51,218,0.25)" }}
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? "שומר…" : "שמור"}
        </button>
        <button
          type="button"
          className={pill}
          style={{
            background: flowActive ? "rgba(226,75,74,0.12)" : "rgba(53,255,112,0.2)",
            color: flowActive ? "#991b1b" : "#0f5132",
            borderColor: "rgba(0,0,0,0.08)",
          }}
          onClick={() => void toggleFlow()}
        >
          {flowActive ? "השבת פלואו" : "הפעל פלואו"}
        </button>
        <span style={{ fontSize: 13, color: "#6b5b9a" }}>
          סטטוס: {flowActive ? <strong style={{ color: GREEN }}>פעיל</strong> : "כבוי"}
        </span>
        {loadErr ? <span style={{ color: "#b91c1c" }}>{loadErr}</span> : null}
      </div>

      <div style={{ display: "flex", gap: 14, alignItems: "stretch", flexWrap: "wrap" }}>
        <div
          style={{
            flex: "1 1 420px",
            height: 560,
            borderRadius: 16,
            border: "1px solid rgba(113,51,218,0.15)",
            background: BG,
            overflow: "hidden",
          }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>

        <aside
          style={{
            flex: "0 0 300px",
            maxWidth: "100%",
            borderRadius: 16,
            border: "1px solid rgba(113,51,218,0.15)",
            background: "white",
            padding: 14,
            alignSelf: "stretch",
          }}
        >
          <h3 style={{ margin: "0 0 10px", fontSize: 16, fontWeight: 600 }}>עריכת נוד</h3>
          {!selected ? (
            <p style={{ color: "#6b5b9a", fontSize: 14 }}>לחצו על נוד בדיאגרמה.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 12, color: "#6b5b9a" }}>
                סוג: <strong>{(selected.data as MfNodeData).flowType}</strong>
              </div>
              <label style={{ fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={Boolean((selected.data as MfNodeData).isStart)}
                  onChange={() => setAsStartOnly()}
                />{" "}
                נוד התחלה (is_start)
              </label>
              {(selected.data as MfNodeData).flowType !== "media" ? (
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                  טקסט
                  <textarea
                    dir="rtl"
                    rows={4}
                    value={(selected.data as MfNodeData).text ?? ""}
                    onChange={(e) => updateSelectedData({ text: e.target.value })}
                    style={{ borderRadius: 10, border: "1px solid #e5e7eb", padding: 8 }}
                  />
                </label>
              ) : null}
              {(selected.data as MfNodeData).flowType === "question" ? (
                <div>
                  <div style={{ fontSize: 12, marginBottom: 6 }}>כפתורים (עד 3)</div>
                  {((selected.data as MfNodeData).buttons ?? []).map((b, i) => (
                    <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                      <input
                        dir="rtl"
                        value={b}
                        onChange={(e) => {
                          const bt = [...((selected.data as MfNodeData).buttons ?? [])];
                          bt[i] = e.target.value;
                          updateSelectedData({ buttons: bt });
                          setEdges((eds) =>
                            eds.map((ed) =>
                              ed.source === selectedId && ed.sourceHandle === `btn-${i}`
                                ? { ...ed, label: e.target.value }
                                : ed
                            )
                          );
                        }}
                        style={{ flex: 1, borderRadius: 8, border: "1px solid #e5e7eb", padding: 6 }}
                      />
                      <button type="button" onClick={() => removeQuestionButton(i)} style={{ fontSize: 12 }}>
                        הסר
                      </button>
                    </div>
                  ))}
                  <button type="button" className={pill} style={{ marginTop: 6 }} onClick={addQuestionButton}>
                    + כפתור
                  </button>
                </div>
              ) : null}
              {(selected.data as MfNodeData).flowType === "media" ? (
                <>
                  <label style={{ fontSize: 12 }}>
                    קובץ (תמונה / וידאו)
                    <input
                      type="file"
                      accept="image/*,video/*"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadMedia(f);
                      }}
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                    URL ציבורי (אופציונלי אם העלאתם)
                    <input
                      dir="ltr"
                      value={(selected.data as MfNodeData).mediaUrl ?? ""}
                      onChange={(e) => updateSelectedData({ mediaUrl: e.target.value })}
                      style={{ borderRadius: 8, border: "1px solid #e5e7eb", padding: 6 }}
                    />
                  </label>
                  <label style={{ fontSize: 12 }}>
                    סוג
                    <select
                      value={(selected.data as MfNodeData).mediaKind ?? "image"}
                      onChange={(e) => updateSelectedData({ mediaKind: e.target.value as "image" | "video" })}
                      style={{ marginInlineStart: 8 }}
                    >
                      <option value="image">תמונה</option>
                      <option value="video">וידאו</option>
                    </select>
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                    כיתוב
                    <textarea
                      dir="rtl"
                      rows={3}
                      value={(selected.data as MfNodeData).caption ?? ""}
                      onChange={(e) => updateSelectedData({ caption: e.target.value })}
                      style={{ borderRadius: 10, border: "1px solid #e5e7eb", padding: 8 }}
                    />
                  </label>
                </>
              ) : null}
              {(selected.data as MfNodeData).flowType === "cta" ? (
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                  URL
                  <input
                    dir="ltr"
                    value={(selected.data as MfNodeData).url ?? ""}
                    onChange={(e) => updateSelectedData({ url: e.target.value })}
                    style={{ borderRadius: 8, border: "1px solid #e5e7eb", padding: 6 }}
                  />
                </label>
              ) : null}
              {(selected.data as MfNodeData).flowType === "followup" ? (
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                  דקות המתנה
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={(selected.data as MfNodeData).delayMinutes ?? 20}
                    onChange={(e) => updateSelectedData({ delayMinutes: Number(e.target.value) || 20 })}
                    style={{ borderRadius: 8, border: "1px solid #e5e7eb", padding: 6 }}
                  />
                </label>
              ) : null}
              <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 8 }}>
                משאלה: חברו ידנית חיצים — משאלה מכמה ידיות (כפתורים), משאר הנודים מחץ אחד למטה.
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

export default function MarketingFlowTab() {
  return (
    <ReactFlowProvider>
      <div style={{ marginBottom: 12 }}>
        <Link href="/admin/dashboard" style={{ color: PURPLE, fontSize: 14 }}>
          ← חזרה לדשבורד ראשי
        </Link>
      </div>
      <FlowCanvas />
    </ReactFlowProvider>
  );
}
