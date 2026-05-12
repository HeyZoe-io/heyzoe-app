"use client";

import {
  addEdge,
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  getBezierPath,
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
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

const NodeDeleteCtx = createContext<((id: string) => void) | null>(null);

function NodeDeleteControl({ id }: { id: string }) {
  const onDelete = useContext(NodeDeleteCtx);
  if (!onDelete) return null;
  return (
    <button
      type="button"
      aria-label="מחק נוד"
      onClick={(ev) => {
        ev.stopPropagation();
        onDelete(id);
      }}
      style={{
        position: "absolute",
        top: 6,
        right: 6,
        width: 22,
        height: 22,
        lineHeight: "20px",
        padding: 0,
        borderRadius: 999,
        border: "1px solid rgba(0,0,0,0.15)",
        background: "rgba(255,255,255,0.96)",
        color: "#333",
        cursor: "pointer",
        fontSize: 15,
        fontWeight: 700,
        zIndex: 3,
      }}
    >
      ×
    </button>
  );
}

const EdgeActionCtx = createContext<{
  selectedEdgeId: string | null;
  reverseEdge: (id: string) => void;
  deleteEdge: (id: string) => void;
  selectEdge: (id: string | null) => void;
} | null>(null);

function InteractiveEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, label, style, markerEnd } = props;
  const ctx = useContext(EdgeActionCtx);
  const isSelected = ctx?.selectedEdgeId === id;

  const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });

  return (
    <>
      <BaseEdge path={edgePath} style={style} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        {label && (
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY - (isSelected ? 18 : 0)}px)`,
              pointerEvents: "none",
              background: "rgba(255,255,255,0.95)",
              padding: "2px 6px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 500,
              color: PURPLE,
            }}
            className="nodrag nopan"
          >
            {label}
          </div>
        )}
        {isSelected && (
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY + (label ? 12 : 0)}px)`,
              display: "flex",
              gap: 4,
              pointerEvents: "all",
            }}
            className="nodrag nopan"
          >
            <button
              type="button"
              title="הפוך כיוון"
              onClick={(e) => { e.stopPropagation(); ctx?.reverseEdge(id); }}
              style={{
                width: 26,
                height: 26,
                borderRadius: 999,
                border: "1px solid rgba(113,51,218,0.3)",
                background: "#fff",
                cursor: "pointer",
                fontSize: 14,
                lineHeight: "24px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                color: PURPLE,
                fontWeight: 700,
              }}
            >
              ⇄
            </button>
            <button
              type="button"
              title="מחק חיבור"
              onClick={(e) => { e.stopPropagation(); ctx?.deleteEdge(id); }}
              style={{
                width: 26,
                height: 26,
                borderRadius: 999,
                border: "1px solid rgba(220,50,50,0.3)",
                background: "#fff",
                cursor: "pointer",
                fontSize: 15,
                lineHeight: "24px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#dc3232",
                fontWeight: 700,
              }}
            >
              ×
            </button>
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}

const edgeTypes = { interactive: InteractiveEdge };

const PURPLE = "#7133da";
const GREEN = "#35ff70";
const BG = "#f5f3ff";

const MARKETING_PHONE_DISPLAY = "+972 3-382-4981";
const MARKETING_PHONE_WA_ME = "97233824981";

function MarketingWhatsAppNumber() {
  const [status, setStatus] = useState<"loading" | "CONNECTED" | "PENDING" | "UNVERIFIED" | "error">("loading");
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch("/api/admin/marketing/whatsapp-status", { cache: "no-store" });
        if (cancelled) return;
        if (!r.ok) { setStatus("error"); return; }
        const j = (await r.json()) as { status?: string };
        const s = String(j?.status ?? "").toUpperCase();
        if (s === "CONNECTED" || s === "PENDING" || s === "UNVERIFIED") setStatus(s);
        else setStatus("error");
      } catch { if (!cancelled) setStatus("error"); }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); }, []);

  const copy = useCallback(async () => {
    try { await navigator.clipboard.writeText(MARKETING_PHONE_DISPLAY); }
    catch {
      const ta = document.createElement("textarea");
      ta.value = MARKETING_PHONE_DISPLAY;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1400);
  }, []);

  const badge = (() => {
    if (status === "CONNECTED") return { bg: "#ecfdf5", color: "#047857", border: "#a7f3d0", text: "מחובר" };
    if (status === "PENDING") return { bg: "#fffbeb", color: "#92400e", border: "#fde68a", text: "בתהליך אישור" };
    if (status === "UNVERIFIED") return { bg: "#fff1f2", color: "#be123c", border: "#fecdd3", text: "לא מאומת" };
    if (status === "error") return { bg: "#fff1f2", color: "#be123c", border: "#fecdd3", text: "שגיאה" };
    return null;
  })();

  return (
    <div
      dir="rtl"
      style={{
        borderRadius: 18,
        border: "1px solid rgba(113,51,218,0.18)",
        background: "#fff",
        padding: "14px 18px",
        marginTop: 14,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 14,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#1a0a3c" }}>מספר WhatsApp שיווקי</div>
          <div style={{ fontSize: 12, color: "#6b5b9a", marginTop: 2 }}>המספר ששולח את הודעות הפלואו</div>
        </div>
        {badge && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              borderRadius: 999,
              background: badge.bg,
              color: badge.color,
              border: `1px solid ${badge.border}`,
              padding: "4px 10px",
              fontSize: 11,
              fontWeight: 500,
            }}
          >
            {status === "CONNECTED" && (
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#10b981", display: "inline-block" }} />
            )}
            {badge.text}
          </span>
        )}
        {status === "loading" && (
          <span style={{ fontSize: 12, color: "#6b5b9a" }}>בודק סטטוס…</span>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span dir="ltr" style={{ fontSize: 15, fontWeight: 600, color: "#1a0a3c", letterSpacing: 0.3 }}>
          {MARKETING_PHONE_DISPLAY}
        </span>

        <button
          type="button"
          onClick={() => void copy()}
          title="העתק מספר"
          style={{
            height: 34,
            width: 34,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 10,
            border: "1px solid rgba(113,51,218,0.18)",
            background: "#fff",
            cursor: "pointer",
            fontSize: 15,
            color: "#6b5b9a",
          }}
        >
          {copied ? "✓" : "📋"}
        </button>

        <a
          href={`https://wa.me/${MARKETING_PHONE_WA_ME}?text=${encodeURIComponent("היי")}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            height: 34,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            borderRadius: 10,
            border: "1px solid rgba(113,51,218,0.18)",
            background: "#fff",
            padding: "0 12px",
            fontSize: 12,
            fontWeight: 600,
            color: "#1a0a3c",
            textDecoration: "none",
            cursor: "pointer",
          }}
        >
          שלח הודעה
        </a>
      </div>

      {copied && (
        <div style={{ width: "100%", fontSize: 12, color: "#047857", marginTop: -6 }}>המספר הועתק</div>
      )}
    </div>
  );
}

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
  position: "relative",
  borderRadius: 16,
  padding: "12px 14px",
  paddingTop: 28,
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
      <NodeDeleteControl id={props.id} />
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
      <NodeDeleteControl id={props.id} />
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
    <div style={{ ...nodeBase, background: "rgba(53,255,112,0.18)", border: "1px solid rgba(53,255,112,0.55)", color: "#0f3d24" }}>
      <NodeDeleteControl id={props.id} />
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
      <NodeDeleteControl id={props.id} />
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
      <NodeDeleteControl id={props.id} />
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
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
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
        setNodes(Array.isArray(j.nodes) ? (j.nodes as Node<MfNodeData>[]) : []);
        setEdges(
          Array.isArray(j.edges)
            ? (j.edges as Edge[]).map((e) => ({ ...e, type: "interactive" }))
            : []
        );
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
            type: "interactive",
            markerEnd: { type: MarkerType.ArrowClosed, color: PURPLE },
            style: { stroke: PURPLE, strokeWidth: 1.5 },
            label: label || undefined,
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

  const removeNode = useCallback(
    (id: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== id));
      setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
      setSelectedId((cur) => (cur === id ? null : cur));
    },
    [setEdges, setNodes]
  );

  const reverseEdge = useCallback(
    (id: string) => {
      setEdges((eds) =>
        eds.map((e) => {
          if (e.id !== id) return e;
          return {
            ...e,
            source: e.target,
            target: e.source,
            sourceHandle: e.targetHandle ?? null,
            targetHandle: e.sourceHandle ?? null,
          } as Edge;
        })
      );
    },
    [setEdges]
  );

  const deleteEdge = useCallback(
    (id: string) => {
      setEdges((eds) => eds.filter((e) => e.id !== id));
      setSelectedEdgeId((cur) => (cur === id ? null : cur));
    },
    [setEdges]
  );

  const edgeActionCtx = useMemo(
    () => ({ selectedEdgeId, reverseEdge, deleteEdge, selectEdge: setSelectedEdgeId }),
    [selectedEdgeId, reverseEdge, deleteEdge]
  );

  const dirtyRef = useRef(false);
  const savedOnceRef = useRef(false);

  useEffect(() => {
    if (!savedOnceRef.current && loading) return;
    dirtyRef.current = true;
  }, [nodes, edges, flowActive, loading]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  const save = useCallback(async () => {
    setSaveMsg(null);
    try {
      const cleanNodes = nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: n.data,
      }));
      const cleanEdges = edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
        label: e.label ?? "",
      }));
      const r = await fetch("/api/admin/marketing/flow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodes: cleanNodes,
          edges: cleanEdges,
          is_active: flowActive,
        }),
      });
      if (!r.ok) {
        const errBody = await r.text().catch(() => "");
        console.error("[MarketingFlowBuilder] save failed:", r.status, errBody);
        let detail = "";
        try { detail = (JSON.parse(errBody) as { error?: string }).error ?? ""; } catch { detail = errBody; }
        setSaveMsg(`שגיאת שמירה (${r.status}): ${detail || "unknown"}`);
        return;
      }
      dirtyRef.current = false;
      savedOnceRef.current = true;
      setSaveMsg("נשמר ב-Supabase");
    } catch (err) {
      console.error("[MarketingFlowBuilder] save exception:", err);
      setSaveMsg(`שגיאת שמירה: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [edges, flowActive, nodes]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
      <MarketingWhatsAppNumber />
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
          <EdgeActionCtx.Provider value={edgeActionCtx}>
          <NodeDeleteCtx.Provider value={removeNode}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              fitView
              onNodeClick={(_, n) => { setSelectedId(n.id); setSelectedEdgeId(null); }}
              onEdgeClick={(_, e) => { setSelectedEdgeId(e.id); setSelectedId(null); }}
              onPaneClick={() => { setSelectedId(null); setSelectedEdgeId(null); }}
              proOptions={{ hideAttribution: true }}
              defaultEdgeOptions={{
                type: "interactive",
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
          </NodeDeleteCtx.Provider>
          </EdgeActionCtx.Provider>
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
