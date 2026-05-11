"use client";

import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useState } from "react";

const PURPLE = "#7133da";
const GREEN = "#35ff70";
const BG = "#f5f3ff";

export type MfFlowType = "message" | "question" | "media" | "cta" | "followup";

export type MfNodeData = {
  text?: string;
  buttons?: string[];
  mediaKind?: "image" | "video";
  mediaUrl?: string;
  url?: string;
  delayMinutes?: number;
};

const nodeBase: React.CSSProperties = {
  borderRadius: 16,
  padding: "12px 14px",
  minWidth: 200,
  maxWidth: 280,
  fontSize: 13,
  textAlign: "right",
  direction: "rtl",
};

function MessageNode(props: NodeProps<Node<MfNodeData>>) {
  const d = props.data ?? {};
  return (
    <div style={{ ...nodeBase, background: "#fff", border: `2px solid ${PURPLE}`, color: "#1a0a3c" }}>
      <Handle type="target" position={Position.Left} style={{ background: PURPLE }} />
      <div style={{ fontWeight: 600, color: PURPLE, marginBottom: 8 }}>הודעה</div>
      <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{String(d.text || "—")}</div>
      <Handle type="source" position={Position.Right} id="out" style={{ background: PURPLE }} />
    </div>
  );
}

function QuestionNode(props: NodeProps<Node<MfNodeData>>) {
  const d = props.data ?? {};
  const buttons = Array.isArray(d.buttons) && d.buttons.length ? d.buttons : ["כן", "לא"];
  return (
    <div style={{ ...nodeBase, background: "rgba(113,51,218,0.12)", border: `1px solid rgba(113,51,218,0.35)`, color: "#1a0a3c" }}>
      <Handle type="target" position={Position.Left} style={{ background: PURPLE }} />
      <div style={{ fontWeight: 600, color: PURPLE, marginBottom: 8 }}>שאלה</div>
      <div style={{ whiteSpace: "pre-wrap", marginBottom: 10, lineHeight: 1.45 }}>{String(d.text || "—")}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "#4a3d7a" }}>
        {buttons.map((b, i) => (
          <span key={i} style={{ border: "1px solid rgba(113,51,218,0.35)", borderRadius: 10, padding: "4px 8px", background: "#fff" }}>
            {b}
          </span>
        ))}
      </div>
      {buttons.map((_, i) => (
        <Handle
          key={i}
          type="source"
          position={Position.Right}
          id={`btn-${i}`}
          style={{
            background: PURPLE,
            top: `${28 + ((i + 1) * 100) / (buttons.length + 2)}%`,
          }}
        />
      ))}
    </div>
  );
}

function MediaNode(props: NodeProps<Node<MfNodeData>>) {
  const d = props.data ?? {};
  const kind = d.mediaKind === "video" ? "וידאו" : "תמונה";
  return (
    <div style={{ ...nodeBase, background: "rgba(53,255,112,0.18)", border: `1px solid rgba(53,255,112,0.55)`, color: "#0f3d24" }}>
      <Handle type="target" position={Position.Left} style={{ background: GREEN }} />
      <div style={{ fontWeight: 600, color: "#0b5c2e", marginBottom: 8 }}>מדיה</div>
      <div style={{ fontSize: 12, marginBottom: 6 }}>סוג: {kind}</div>
      <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{String(d.text || d.mediaUrl || "—")}</div>
      <Handle type="source" position={Position.Right} id="out" style={{ background: GREEN }} />
    </div>
  );
}

function CtaNode(props: NodeProps<Node<MfNodeData>>) {
  const d = props.data ?? {};
  return (
    <div
      style={{
        ...nodeBase,
        background: "linear-gradient(135deg, rgba(113,51,218,0.95), rgba(255,146,255,0.85))",
        border: "1px solid rgba(255,255,255,0.35)",
        color: "#fff",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: "#fff" }} />
      <div style={{ fontWeight: 600, marginBottom: 8 }}>הנעה לפעולה</div>
      <div style={{ whiteSpace: "pre-wrap", marginBottom: 6, lineHeight: 1.45 }}>{String(d.text || "—")}</div>
      <div style={{ fontSize: 12, opacity: 0.95, wordBreak: "break-all" }}>{String(d.url || "")}</div>
      <Handle type="source" position={Position.Right} id="out" style={{ background: "#fff" }} />
    </div>
  );
}

function FollowupNode(props: NodeProps<Node<MfNodeData>>) {
  const d = props.data ?? {};
  const m = typeof d.delayMinutes === "number" && Number.isFinite(d.delayMinutes) ? d.delayMinutes : 20;
  return (
    <div style={{ ...nodeBase, background: "rgba(0,0,0,0.06)", border: "1px solid rgba(0,0,0,0.12)", color: "#1a0a3c" }}>
      <Handle type="target" position={Position.Left} style={{ background: "#888" }} />
      <div style={{ fontWeight: 600, color: "#555", marginBottom: 8 }}>פולואפ</div>
      <div style={{ whiteSpace: "pre-wrap", marginBottom: 8, lineHeight: 1.45 }}>{String(d.text || "—")}</div>
      <div style={{ fontSize: 12, color: "#555" }}>המתנה: {m} דק׳</div>
      <Handle type="source" position={Position.Right} id="out" style={{ background: "#888" }} />
    </div>
  );
}

const nodeTypes = {
  message: MessageNode,
  question: QuestionNode,
  media: MediaNode,
  cta: CtaNode,
  followup: FollowupNode,
};

function defaultDataForType(t: MfFlowType): MfNodeData {
  switch (t) {
    case "message":
      return { text: "טקסט הודעה" };
    case "question":
      return { text: "שאלה?", buttons: ["אפשרות א׳", "אפשרות ב׳"] };
    case "media":
      return { text: "", mediaKind: "image", mediaUrl: "" };
    case "cta":
      return { text: "לחצו כאן", url: "https://" };
    case "followup":
      return { text: "פולואפ", delayMinutes: 20 };
    default:
      return {};
  }
}

function MarketingFlowCanvas() {
  const { getNode, screenToFlowPosition } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<MfNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addType, setAddType] = useState<MfFlowType>("message");
  const [flowActive, setFlowActive] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const selected = useMemo(() => nodes.find((n) => n.id === selectedId) ?? null, [nodes, selectedId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/admin/marketing/flow", { method: "GET", cache: "no-store" });
        const j = (await r.json()) as { nodes?: Node<MfNodeData>[]; edges?: Edge[]; is_active?: boolean };
        if (cancelled) return;
        if (Array.isArray(j.nodes) && j.nodes.length) setNodes(j.nodes as Node<MfNodeData>[]);
        if (Array.isArray(j.edges) && j.edges.length) setEdges(j.edges as Edge[]);
        if (typeof j.is_active === "boolean") setFlowActive(j.is_active);
      } catch {
        /* stub / offline */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setEdges, setNodes]);

  const onConnect = useCallback(
    (c: Connection) => {
      const src = c.source ? getNode(c.source) : null;
      let label = "";
      if (src?.type === "question" && c.sourceHandle?.startsWith("btn-")) {
        const i = Number.parseInt(c.sourceHandle.replace("btn-", ""), 10);
        const btns = (src.data as MfNodeData)?.buttons ?? [];
        label = String(btns[i] ?? "").trim();
      }
      setEdges((eds) =>
        addEdge(
          {
            ...c,
            id: `e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            markerEnd: { type: MarkerType.ArrowClosed, color: PURPLE },
            style: { stroke: PURPLE, strokeWidth: 1.5 },
            label: label || undefined,
            labelStyle: { fill: PURPLE, fontWeight: 500, fontSize: 11 },
            labelBgPadding: [4, 4] as [number, number],
            labelBgBorderRadius: 6,
            labelBgStyle: { fill: "#fff", fillOpacity: 0.95 },
          },
          eds
        )
      );
    },
    [getNode, setEdges]
  );

  const addNode = useCallback(() => {
    const id = `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const pos = screenToFlowPosition({ x: typeof window !== "undefined" ? window.innerWidth * 0.42 : 400, y: 260 });
    const t = addType;
    setNodes((nds) =>
      nds.concat({
        id,
        type: t,
        position: pos,
        data: defaultDataForType(t),
      } as Node<MfNodeData>)
    );
    setSelectedId(id);
  }, [addType, screenToFlowPosition, setNodes]);

  const updateSelectedData = useCallback(
    (patch: Partial<MfNodeData>) => {
      if (!selectedId) return;
      setNodes((nds) =>
        nds.map((n) => (n.id === selectedId ? { ...n, data: { ...(n.data as MfNodeData), ...patch } } : n))
      );
    },
    [selectedId, setNodes]
  );

  const setQuestionButton = useCallback(
    (index: number, value: string) => {
      if (!selected || selected.type !== "question") return;
      const buttons = [...((selected.data as MfNodeData)?.buttons ?? ["א", "ב"])];
      buttons[index] = value;
      updateSelectedData({ buttons });
    },
    [selected, updateSelectedData]
  );

  const addQuestionButton = useCallback(() => {
    if (!selected || selected.type !== "question") return;
    const buttons = [...((selected.data as MfNodeData)?.buttons ?? [])];
    if (buttons.length >= 6) return;
    buttons.push(`כפתור ${buttons.length + 1}`);
    updateSelectedData({ buttons });
  }, [selected, updateSelectedData]);

  const removeQuestionButton = useCallback(
    (index: number) => {
      if (!selected || selected.type !== "question") return;
      const buttons = [...((selected.data as MfNodeData)?.buttons ?? [])];
      if (buttons.length <= 2) return;
      buttons.splice(index, 1);
      updateSelectedData({ buttons });
      setEdges((eds) =>
        eds.filter((e) => !(e.source === selected.id && String(e.sourceHandle ?? "").startsWith("btn-")))
      );
    },
    [selected, setEdges, updateSelectedData]
  );

  const save = useCallback(async () => {
    setSaveMsg(null);
    try {
      const r = await fetch("/api/admin/marketing/flow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodes,
          edges,
          is_active: flowActive,
        }),
      });
      if (!r.ok) throw new Error(String(r.status));
      setSaveMsg("נשמר (שרת ללא לוגיקה)");
    } catch {
      setSaveMsg("שגיאת שמירה");
    }
  }, [edges, flowActive, nodes]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
          justifyContent: "flex-start",
          direction: "rtl",
        }}
      >
        <span style={{ fontSize: 13, color: "#6b5b9a" }}>הוסף נוד:</span>
        <select
          value={addType}
          onChange={(e) => setAddType(e.target.value as MfFlowType)}
          style={{
            height: 38,
            borderRadius: 12,
            border: `1px solid rgba(113,51,218,0.25)`,
            padding: "0 10px",
            fontFamily: "inherit",
            background: "#fff",
            color: "#1a0a3c",
          }}
        >
          <option value="message">הודעה</option>
          <option value="question">שאלה</option>
          <option value="media">מדיה</option>
          <option value="cta">הנעה לפעולה</option>
          <option value="followup">פולואפ</option>
        </select>
        <button
          type="button"
          onClick={addNode}
          style={{
            height: 38,
            padding: "0 16px",
            borderRadius: 999,
            border: `1px solid rgba(113,51,218,0.25)`,
            background: PURPLE,
            color: "#fff",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          הוסף נוד
        </button>
        <button
          type="button"
          onClick={() => void save()}
          style={{
            height: 38,
            padding: "0 16px",
            borderRadius: 999,
            border: `1px solid rgba(113,51,218,0.25)`,
            background: "linear-gradient(135deg,#7133da,#ff92ff)",
            color: "#fff",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          שמור
        </button>
        <button
          type="button"
          onClick={() => setFlowActive((v) => !v)}
          style={{
            height: 38,
            padding: "0 16px",
            borderRadius: 999,
            border: `1px solid rgba(113,51,218,0.25)`,
            background: flowActive ? "rgba(53,255,112,0.25)" : "#fff",
            color: "#1a0a3c",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {flowActive ? "השבת פלואו" : "הפעל פלואו"}
        </button>
        {saveMsg ? <span style={{ fontSize: 13, color: saveMsg.startsWith("נשמר") ? "#0b5c2e" : "#b42318" }}>{saveMsg}</span> : null}
        {loading ? <span style={{ fontSize: 12, color: "#6b5b9a" }}>טוען…</span> : null}
      </div>

      <div style={{ display: "flex", gap: 14, alignItems: "stretch", flexWrap: "wrap", direction: "rtl" }}>
        <div
          dir="ltr"
          style={{
            flex: "1 1 420px",
            minHeight: 480,
            minWidth: 280,
            borderRadius: 18,
            border: `1px solid rgba(113,51,218,0.18)`,
            overflow: "hidden",
            background: BG,
          }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
            onNodeClick={(_, n) => setSelectedId(n.id)}
            onPaneClick={() => setSelectedId(null)}
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{
              style: { stroke: PURPLE, strokeWidth: 1.5 },
              markerEnd: { type: MarkerType.ArrowClosed, color: PURPLE },
            }}
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="rgba(113,51,218,0.2)" />
            <Controls showInteractive={false} />
            <MiniMap
              style={{ borderRadius: 12 }}
              maskColor="rgba(113,51,218,0.12)"
              nodeColor={() => PURPLE}
            />
          </ReactFlow>
        </div>

        <aside
          style={{
            flex: "0 0 300px",
            maxWidth: "100%",
            borderRadius: 18,
            border: `1px solid rgba(113,51,218,0.18)`,
            background: "#fff",
            padding: 16,
            textAlign: "right",
            direction: "rtl",
            maxHeight: 560,
            overflow: "auto",
          }}
        >
          <div style={{ fontWeight: 600, color: PURPLE, marginBottom: 12 }}>עריכת נוד</div>
          {!selected ? (
            <p style={{ margin: 0, fontSize: 14, color: "#6b5b9a" }}>בחרו נוד בדיאגרמה.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ fontSize: 12, color: "#6b5b9a" }}>
                סוג: <strong style={{ color: "#1a0a3c" }}>{selected.type}</strong>
              </div>
              {(selected.type === "message" || selected.type === "question" || selected.type === "followup") && (
                <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
                  <span>טקסט</span>
                  <textarea
                    rows={5}
                    value={String((selected.data as MfNodeData)?.text ?? "")}
                    onChange={(e) => updateSelectedData({ text: e.target.value })}
                    style={{ borderRadius: 12, border: `1px solid rgba(113,51,218,0.2)`, padding: 8, fontFamily: "inherit" }}
                  />
                </label>
              )}
              {selected.type === "question" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <span style={{ fontSize: 13 }}>כפתורים</span>
                  {(((selected.data as MfNodeData)?.buttons ?? []) as string[]).map((b, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        value={b}
                        onChange={(e) => setQuestionButton(i, e.target.value)}
                        style={{ flex: 1, borderRadius: 10, border: `1px solid rgba(113,51,218,0.2)`, padding: "6px 8px" }}
                      />
                      <button
                        type="button"
                        onClick={() => removeQuestionButton(i)}
                        disabled={(((selected.data as MfNodeData)?.buttons ?? []) as string[]).length <= 2}
                        style={{
                          borderRadius: 8,
                          border: "1px solid #ddd",
                          background: "#fafafa",
                          cursor: "pointer",
                          padding: "4px 8px",
                        }}
                      >
                        הסר
                      </button>
                    </div>
                  ))}
                  <button type="button" onClick={addQuestionButton} style={{ alignSelf: "flex-start", borderRadius: 10, padding: "6px 12px", border: `1px solid ${PURPLE}`, background: "#fff", color: PURPLE, cursor: "pointer" }}>
                    הוסף כפתור
                  </button>
                </div>
              )}
              {selected.type === "media" && (
                <>
                  <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
                    <span>סוג מדיה</span>
                    <select
                      value={(selected.data as MfNodeData)?.mediaKind === "video" ? "video" : "image"}
                      onChange={(e) => updateSelectedData({ mediaKind: e.target.value as "image" | "video" })}
                      style={{ borderRadius: 12, border: `1px solid rgba(113,51,218,0.2)`, padding: 8 }}
                    >
                      <option value="image">תמונה</option>
                      <option value="video">וידאו</option>
                    </select>
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
                    <span>קישור לקובץ (URL)</span>
                    <input
                      value={String((selected.data as MfNodeData)?.mediaUrl ?? "")}
                      onChange={(e) => updateSelectedData({ mediaUrl: e.target.value })}
                      style={{ borderRadius: 12, border: `1px solid rgba(113,51,218,0.2)`, padding: 8 }}
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
                    <span>כיתוב / טקסט</span>
                    <textarea
                      rows={3}
                      value={String((selected.data as MfNodeData)?.text ?? "")}
                      onChange={(e) => updateSelectedData({ text: e.target.value })}
                      style={{ borderRadius: 12, border: `1px solid rgba(113,51,218,0.2)`, padding: 8, fontFamily: "inherit" }}
                    />
                  </label>
                </>
              )}
              {selected.type === "cta" && (
                <>
                  <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
                    <span>טקסט</span>
                    <textarea
                      rows={3}
                      value={String((selected.data as MfNodeData)?.text ?? "")}
                      onChange={(e) => updateSelectedData({ text: e.target.value })}
                      style={{ borderRadius: 12, border: `1px solid rgba(113,51,218,0.2)`, padding: 8, fontFamily: "inherit" }}
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
                    <span>URL</span>
                    <input
                      value={String((selected.data as MfNodeData)?.url ?? "")}
                      onChange={(e) => updateSelectedData({ url: e.target.value })}
                      style={{ borderRadius: 12, border: `1px solid rgba(113,51,218,0.2)`, padding: 8 }}
                    />
                  </label>
                </>
              )}
              {selected.type === "followup" && (
                <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
                  <span>דקות המתנה</span>
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={(selected.data as MfNodeData)?.delayMinutes ?? 20}
                    onChange={(e) => updateSelectedData({ delayMinutes: Number(e.target.value) || 1 })}
                    style={{ borderRadius: 12, border: `1px solid rgba(113,51,218,0.2)`, padding: 8 }}
                  />
                </label>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

export default function MarketingFlowBuilder() {
  return (
    <ReactFlowProvider>
      <MarketingFlowCanvas />
    </ReactFlowProvider>
  );
}
