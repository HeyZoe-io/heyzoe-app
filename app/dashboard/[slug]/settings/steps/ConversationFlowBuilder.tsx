"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Loader2, Undo2 } from "lucide-react";
import { clampWaReplyButtonTitle, WA_REPLY_BUTTON_TITLE_MAX_CHARS } from "@/lib/wa-button-label";
import { uploadDashboardWhatsAppMedia } from "@/lib/upload-dashboard-media-client";
import { WHATSAPP_MEDIA_CAPTION_MAX_CHARS } from "@/lib/whatsapp-media-limits";

type FlowType = "message" | "question" | "product" | "daytime" | "register" | "followup" | "details";

type FlowData = {
  text?: string;
  buttons?: string[];
  product_slug?: string;
  day_text?: string;
  day_buttons?: string[];
  time_text?: string;
  time_buttons?: string[];
  delay_minutes?: number;
  media_url?: string;
  media_kind?: "image" | "video" | "";
};

type ProductOption = { slug: string; name: string; slots: string[] };

const TYPE_LABEL: Record<FlowType, string> = {
  message: "הודעה",
  question: "שאלה",
  product: "מוצר",
  daytime: "יום ושעה",
  register: "אישור הרשמה",
  followup: "פולואפ",
  details: "איסוף פרטים",
};

const ADD_TYPES: FlowType[] = ["message", "question", "product", "register", "followup", "details"];

function delayMinutesOf(data: FlowData): number {
  const n = Number(data.delay_minutes);
  if (!Number.isFinite(n)) return 120;
  return Math.min(7 * 24 * 60, Math.max(5, Math.round(n)));
}

function delayLabel(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "אחרי שעה" : `אחרי ${hours} שעות`;
  }
  return `אחרי ${minutes} דקות`;
}
const MAX_NODE_BUTTONS = 10;

function capButtonList(list: string[] | undefined): string[] | undefined {
  if (!list) return list;
  return list.slice(0, MAX_NODE_BUTTONS).map((label) => clampWaReplyButtonTitle(label));
}

function capFlowData(data: FlowData): FlowData {
  return {
    ...data,
    buttons: capButtonList(data.buttons),
    day_buttons: capButtonList(data.day_buttons),
    time_buttons: capButtonList(data.time_buttons),
  };
}

function newId() {
  return crypto.randomUUID();
}

const deleteNodeContext = createContext<(id: string) => void>(() => {});
const productsContext = createContext<ProductOption[]>([]);
const daytimeSlotsContext = createContext<Map<string, string[]>>(new Map());

function cardStyle(selected: boolean): CSSProperties {
  return {
    position: "relative",
    width: 132,
    borderRadius: 10,
    border: selected ? "1.5px solid #7133da" : "1px solid rgba(24,24,27,0.1)",
    background: "#fff",
    boxShadow: "0 1px 2px rgba(24,24,27,0.06)",
    padding: "6px 7px 5px",
    textAlign: "right",
    direction: "rtl",
  };
}

function FlowNodeCard({ id, data, selected, type }: NodeProps<Node<FlowData, FlowType>>) {
  const d = data ?? {};
  const buttons = (Array.isArray(d.buttons) ? d.buttons : []).slice(0, MAX_NODE_BUTTONS);
  const deleteNode = useContext(deleteNodeContext);
  const products = useContext(productsContext);
  const daytimeSlots = useContext(daytimeSlotsContext);
  const chosenProduct = products.find((product) => product.slug === String(d.product_slug ?? ""));
  const chosenProductName = String(chosenProduct?.name || d.product_slug || "").trim();
  const scheduleSlots = daytimeSlots.get(id) ?? [];
  return (
    <div style={cardStyle(Boolean(selected))}>
      <button
        type="button"
        className="nodrag nopan"
        aria-label="מחיקת תיבה"
        onClick={(event) => {
          event.stopPropagation();
          deleteNode(id);
        }}
        style={{
          position: "absolute",
          top: -7,
          left: -7,
          zIndex: 2,
          width: 18,
          height: 18,
          borderRadius: 999,
          border: "1px solid rgba(24,24,27,0.14)",
          background: "#fff",
          color: "#71717a",
          fontSize: 13,
          lineHeight: "14px",
          cursor: "pointer",
          padding: 0,
        }}
      >
        ×
      </button>
      <Handle type="target" position={Position.Right} style={{ background: "#7133da" }} />
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.2, color: "#7133da", marginBottom: 3 }}>{TYPE_LABEL[type]}</div>
      {type === "daytime" ? (
        <div style={{ fontSize: 10, color: "#3f3f46", lineHeight: 1.35 }}>
          {scheduleSlots.length ? (
            scheduleSlots.map((label, i) => (
              <div key={`${label}-${i}`} style={{ marginTop: i ? 3 : 0, fontSize: 9, color: "#3f3f46" }}>{label}</div>
            ))
          ) : (
            <div style={{ color: "#71717a" }}>מועדי לוח מהמוצר</div>
          )}
        </div>
      ) : (
      <div
        style={{
          fontSize: 10,
          color: "#3f3f46",
          lineHeight: 1.35,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {String(d.text || "").trim() || "טקסט ריק"}
      </div>
      )}
      {type === "message" && String(d.media_url ?? "").trim() ? (
        <div style={{ marginTop: 4, fontSize: 9, color: "#71717a" }}>
          {d.media_kind === "video" ? "סרטון" : "תמונה"}
        </div>
      ) : null}
      {type === "followup" ? (
        <div style={{ marginTop: 4, fontSize: 9, color: "#71717a" }}>{delayLabel(delayMinutesOf(d))}</div>
      ) : null}
      {type === "details" ? (
        <div style={{ marginTop: 4, fontSize: 9, color: "#71717a" }}>תשובה פתוחה</div>
      ) : null}
      {type === "product" ? (
        <div
          style={{
            marginTop: 4,
            fontSize: 10,
            fontWeight: 600,
            color: "#18181b",
            lineHeight: 1.35,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {chosenProductName || "בחרי מוצר"}
        </div>
      ) : null}
      {type === "question"
        ? buttons.map((label, i) => (
            <div key={i} style={{ position: "relative", marginTop: 4 }}>
              <div
                style={{
                  borderRadius: 999,
                  border: "1px solid rgba(113,51,218,0.22)",
                  padding: "1px 6px",
                  fontSize: 9,
                  lineHeight: 1.4,
                  color: "#3f3f46",
                  background: "#fafafa",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {label.trim() || `כפתור ${i + 1}`}
              </div>
              <Handle
                type="source"
                position={Position.Left}
                id={`btn-${i}`}
                style={{ background: "#7133da", top: "50%" }}
              />
            </div>
          ))
        : type !== "followup" ? (
          <Handle type="source" position={Position.Left} id="out" style={{ background: "#7133da" }} />
        ) : null}
      <div style={{ position: "relative", marginTop: 6, fontSize: 8, color: "#a1a1aa" }}>
        אין מענה
        <Handle type="source" position={Position.Left} id="silence" style={{ background: "#a1a1aa", top: "50%" }} />
      </div>
    </div>
  );
}

const nodeTypes = {
  message: FlowNodeCard,
  question: FlowNodeCard,
  product: FlowNodeCard,
  daytime: FlowNodeCard,
  register: FlowNodeCard,
  followup: FlowNodeCard,
  details: FlowNodeCard,
};

function emptyDaytime(): FlowData {
  return { day_text: "", day_buttons: ["", ""], time_text: "", time_buttons: ["", ""] };
}

function ensureDaytimeAfterProducts(nodes: Node<FlowData, FlowType>[], edges: Edge[]): {
  nodes: Node<FlowData, FlowType>[];
  edges: Edge[];
} {
  let nextNodes = nodes;
  let nextEdges = edges;
  for (const product of nodes.filter((node) => node.type === "product")) {
    const outIndex = nextEdges.findIndex((edge) => edge.source === product.id && (edge.sourceHandle || "out") === "out");
    const out = outIndex >= 0 ? nextEdges[outIndex] : null;
    const target = out ? nextNodes.find((node) => node.id === out.target) : null;
    if (target?.type === "daytime") continue;
    const dayId = newId();
    const daytime: Node<FlowData, FlowType> = {
      id: dayId,
      type: "daytime",
      position: { x: product.position.x - 200, y: product.position.y },
      data: emptyDaytime(),
    };
    nextNodes = [...nextNodes, daytime];
    if (out) {
      nextEdges = nextEdges.map((edge, index) => (index === outIndex ? { ...edge, target: dayId } : edge));
      nextEdges = [...nextEdges, { id: newId(), source: dayId, target: out.target, sourceHandle: "out" }];
    } else {
      nextEdges = [...nextEdges, { id: newId(), source: product.id, target: dayId, sourceHandle: "out" }];
    }
  }
  return { nodes: nextNodes, edges: nextEdges };
}

type GraphSnapshot = { nodes: Node<FlowData, FlowType>[]; edges: Edge[] };

function graphKey(nodes: Node<FlowData, FlowType>[], edges: Edge[]): string {
  return JSON.stringify(snapshotGraph(nodes, edges));
}

function snapshotGraph(nodes: Node<FlowData, FlowType>[], edges: Edge[]): GraphSnapshot {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: { x: node.position.x, y: node.position.y },
      data: {
        ...node.data,
        buttons: node.data.buttons ? [...node.data.buttons] : undefined,
        day_buttons: node.data.day_buttons ? [...node.data.day_buttons] : undefined,
        time_buttons: node.data.time_buttons ? [...node.data.time_buttons] : undefined,
      },
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
    })),
  };
}

function starterNodes(openingText: string): Node<FlowData, FlowType>[] {
  return [
    {
      id: newId(),
      type: "message",
      position: { x: 720, y: 140 },
      data: { text: openingText },
    },
  ];
}

/** נוד הפתיחה הוא ההתחלה: הודעה בלי חץ נכנס. אם היא ריקה, ממלאים את הג׳ינרוט הרגיל. */
function withDefaultOpening(
  nodes: Node<FlowData, FlowType>[],
  edges: Edge[],
  openingText: string
): Node<FlowData, FlowType>[] {
  const text = openingText.trim();
  if (!nodes.length) return starterNodes(text);
  if (!text) return nodes;
  const targeted = new Set(edges.map((edge) => edge.target));
  const first = nodes
    .filter((node) => !targeted.has(node.id))
    .sort((a, b) => a.position.y - b.position.y || b.position.x - a.position.x)[0];
  if (!first || first.type !== "message" || String(first.data.text ?? "").trim()) return nodes;
  return nodes.map((node) => (node.id === first.id ? { ...node, data: { ...node.data, text } } : node));
}

function ConversationFlowCanvas({ slug }: { slug: string }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<FlowData, FlowType>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [mediaUploading, setMediaUploading] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const [canUndo, setCanUndo] = useState(false);
  const historyRef = useRef<GraphSnapshot[]>([]);
  const savedKey = useRef("");
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const editGesture = useRef(false);
  nodesRef.current = nodes;
  edgesRef.current = edges;
  const flowWrapRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const selected = nodes.find((n) => n.id === selectedId) ?? null;

  useEffect(() => {
    setMediaError("");
  }, [selectedId]);

  const load = useCallback(async () => {
    setStatus("loading");
    setError("");
    try {
      const res = await fetch(`/api/dashboard/conversation-flow?slug=${encodeURIComponent(slug)}`, { cache: "no-store" });
      const json = (await res.json()) as {
        nodes?: Array<{ id: string; type: FlowType; data: FlowData; position_x: number; position_y: number }>;
        edges?: Array<{ id: string; source_node_id: string; target_node_id: string; source_handle: string }>;
        products?: Array<ProductOption & { slots?: string[] }>;
        openingText?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || "load_failed");
      setProducts(
        (json.products ?? []).map((product) => ({
          slug: product.slug,
          name: product.name,
          slots: Array.isArray(product.slots) ? product.slots : [],
        }))
      );
      const loadedEdges = (json.edges ?? []).map((e) => ({
        id: e.id,
        source: e.source_node_id,
        target: e.target_node_id,
        sourceHandle: e.source_handle || "out",
      }));
      const loadedNodes = (json.nodes ?? []).map((n) => ({
        id: n.id,
        type: n.type,
        position: { x: n.position_x, y: n.position_y },
        data: capFlowData(n.data ?? {}),
      }));
      const opened = withDefaultOpening(loadedNodes, loadedEdges, String(json.openingText ?? ""));
      const withSchedule = ensureDaytimeAfterProducts(opened, loadedEdges);
      historyRef.current = [];
      setCanUndo(false);
      savedKey.current = graphKey(withSchedule.nodes, withSchedule.edges);
      setDirty(false);
      editGesture.current = false;
      setNodes(withSchedule.nodes);
      setEdges(withSchedule.edges);
      setStatus("ready");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "load_failed");
    }
  }, [setEdges, setNodes, slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = useCallback(
    async (nextNodes: Node<FlowData, FlowType>[], nextEdges: Edge[]) => {
      setStatus("saving");
      const res = await fetch("/api/dashboard/conversation-flow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          nodes: nextNodes.map((n) => ({
            id: n.id,
            type: n.type,
            data: n.data,
            position_x: n.position.x,
            position_y: n.position.y,
          })),
          edges: nextEdges.map((e) => ({
            source_node_id: e.source,
            target_node_id: e.target,
            source_handle: e.sourceHandle || "out",
          })),
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setStatus("error");
        setError(json.error || "save_failed");
        return;
      }
      savedKey.current = graphKey(nextNodes, nextEdges);
      setStatus("ready");
      setError("");
      setDirty(false);
    },
    [slug]
  );

  useEffect(() => {
    if (!dirty) return;
    const onLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  const remember = useCallback(() => {
    historyRef.current.push(snapshotGraph(nodesRef.current, edgesRef.current));
    if (historyRef.current.length > 50) historyRef.current.shift();
    setCanUndo(true);
  }, []);

  const undo = useCallback(() => {
    const prev = historyRef.current.pop();
    if (!prev) return;
    editGesture.current = false;
    setNodes(prev.nodes);
    setEdges(prev.edges);
    setCanUndo(historyRef.current.length > 0);
    setDirty(graphKey(prev.nodes, prev.edges) !== savedKey.current);
  }, [setEdges, setNodes]);

  const onConnect = useCallback(
    (connection: Connection) => {
      remember();
      setDirty(true);
      const sourceType = nodesRef.current.find((node) => node.id === connection.source)?.type;
      const targetType = nodesRef.current.find((node) => node.id === connection.target)?.type;
      const sourceHandle =
        sourceType === "followup" || targetType === "followup" ? "silence" : connection.sourceHandle || "out";
      setEdges((current) => addEdge({ ...connection, sourceHandle }, current));
    },
    [remember, setEdges]
  );

  const deleteNode = useCallback(
    (id: string) => {
      remember();
      setDirty(true);
      setNodes((current) => current.filter((node) => node.id !== id));
      setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id));
      setSelectedId((current) => (current === id ? null : current));
    },
    [remember, setEdges, setNodes]
  );

  function addNode(type: FlowType) {
    remember();
    setDirty(true);
    const id = newId();
    const data: FlowData =
      type === "question"
        ? { text: "", buttons: ["", ""] }
        : type === "register"
          ? { text: "" }
          : type === "product"
            ? { text: "", product_slug: "" }
            : type === "followup"
              ? { text: "", delay_minutes: 120 }
              : { text: "" };
    const dayId = type === "product" ? newId() : "";
    setNodes((current) => {
      const wrap = flowWrapRef.current?.getBoundingClientRect();
      const center =
        wrap && status !== "loading"
          ? screenToFlowPosition({ x: wrap.left + wrap.width / 2, y: wrap.top + wrap.height / 2 })
          : { x: 240, y: 180 };
      let x = center.x - 66;
      let y = center.y - 28;
      const stacked = current.filter((node) => Math.abs(node.position.x - x) < 36 && Math.abs(node.position.y - y) < 36).length;
      x += stacked * 22;
      y += stacked * 18;
      const created: Node<FlowData, FlowType>[] = [{ id, type, position: { x, y }, data }];
      if (type === "product") {
        created.push({
          id: dayId,
          type: "daytime",
          position: { x: x - 200, y },
          data: emptyDaytime(),
        });
      }
      return [...current, ...created];
    });
    if (type === "product") {
      setEdges((current) => [...current, { id: newId(), source: id, target: dayId, sourceHandle: "out" }]);
    }
    setSelectedId(id);
  }

  function armEditGesture() {
    editGesture.current = false;
  }

  function patchSelected(patch: Partial<FlowData>, gesture = false) {
    if (!selected) return;
    if (!gesture || !editGesture.current) {
      remember();
      if (gesture) editGesture.current = true;
    }
    setDirty(true);
    setNodes((current) => current.map((n) => (n.id === selected.id ? { ...n, data: { ...n.data, ...patch } } : n)));
  }

  const productName = useMemo(() => {
    const slugValue = String(selected?.data.product_slug ?? "");
    return products.find((p) => p.slug === slugValue)?.name ?? "";
  }, [products, selected]);

  const daytimeSlots = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const node of nodes) {
      if (node.type !== "daytime") continue;
      const incoming = edges.find((edge) => edge.target === node.id);
      const source = nodes.find((item) => item.id === incoming?.source);
      const slug = source?.type === "product" ? String(source.data.product_slug ?? "") : "";
      map.set(node.id, products.find((product) => product.slug === slug)?.slots ?? []);
    }
    return map;
  }, [edges, nodes, products]);

  return (
    <div className="w-full text-right [&_input]:!text-right [&_textarea]:!text-right" dir="rtl">
      <div className="flex h-[calc(100dvh-10.5rem)] min-h-[680px] flex-col overflow-hidden rounded-3xl border border-zinc-200/80 bg-white shadow-sm">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3 sm:px-5">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">שיחה</h2>
            <p className="mt-0.5 text-sm text-zinc-500">הודעות, שאלות, איסוף פרטים, מוצר, אישור הרשמה ופולואפ. פולואפ נשלח רק אם אין מענה, אחרי ההשהייה, ורק במסלול שמחובר אליו.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={undo}
              disabled={!canUndo || status === "saving"}
              className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Undo2 className="h-3.5 w-3.5" />
              חזור
            </button>
            <button
              type="button"
              onClick={() => void persist(nodes, edges)}
              disabled={!dirty || status === "saving" || status === "loading"}
              className="rounded-full bg-[#7133da] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#5e28b8] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {status === "saving" ? "שומר…" : "שמירה"}
            </button>
            {ADD_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => addNode(type)}
                className="rounded-full border border-[#7133da]/20 bg-white px-3 py-1.5 text-sm font-medium text-[#7133da] hover:bg-[#7133da]/5"
              >
                {TYPE_LABEL[type]}
              </button>
            ))}
          </div>
        </div>
        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div ref={flowWrapRef} className="relative h-[520px] min-h-0 overflow-hidden bg-[#fafafa] lg:h-full">
            {status === "loading" ? (
              <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
                טוען את השיחה…
              </div>
            ) : (
              <daytimeSlotsContext.Provider value={daytimeSlots}>
              <productsContext.Provider value={products}>
              <deleteNodeContext.Provider value={deleteNode}>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={(changes) => {
                  if (changes.some((change) => change.type === "remove")) {
                    remember();
                    setDirty(true);
                  }
                  onNodesChange(changes);
                }}
                onEdgesChange={(changes) => {
                  if (changes.some((change) => change.type === "remove")) {
                    remember();
                    setDirty(true);
                  }
                  onEdgesChange(changes);
                }}
                onNodeDragStart={() => remember()}
                onNodeDragStop={() => setDirty(true)}
                onConnect={onConnect}
                nodeTypes={nodeTypes}
                onNodeClick={(_, node) => setSelectedId(node.id)}
                onPaneClick={() => setSelectedId(null)}
                fitView
                fitViewOptions={{ padding: 0.45, maxZoom: 0.9 }}
                minZoom={0.35}
                maxZoom={1.35}
                proOptions={{ hideAttribution: true }}
                className="h-full w-full"
              >
                <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#e4e4e7" />
                <Controls showInteractive={false} />
              </ReactFlow>
              </deleteNodeContext.Provider>
              </productsContext.Provider>
              </daytimeSlotsContext.Provider>
            )}
          </div>
          <aside className="border-t border-zinc-100 p-4 lg:border-s lg:border-t-0">
            {!selected ? (
              <p className="text-sm leading-relaxed text-zinc-500">בחרי תיבה כדי לערוך את הטקסט. מכל כפתור בשאלה יוצא חץ לענף אחר.</p>
            ) : (
              <div className="space-y-3">
                <div className="text-sm font-semibold text-zinc-900">{TYPE_LABEL[selected.type as FlowType]}</div>
                {selected.type === "message" || selected.type === "question" || selected.type === "register" || selected.type === "followup" || selected.type === "details" ? (
                  <label className="block text-sm text-zinc-700">
                    טקסט
                    <textarea
                      rows={5}
                      value={String(selected.data.text ?? "")}
                      onFocus={armEditGesture}
                      onChange={(e) => patchSelected({ text: e.target.value }, true)}
                      placeholder={
                        selected.type === "register"
                          ? "רשמתי אותך ל{מוצר} ב{יום} בשעה {שעה}."
                          : selected.type === "details"
                            ? "ספרו לי בקצרה מה חשוב שנדע"
                            : "כתבי את ההודעה"
                      }
                      className="mt-1 w-full resize-none rounded-2xl border border-zinc-200 bg-zinc-50/60 px-3 py-2 text-sm text-zinc-800 outline-none focus:border-[#7133da]/40"
                    />
                  </label>
                ) : selected.type === "product" ? (
                  <label className="block text-sm text-zinc-700">
                    טקסט לפני המעבר
                    <textarea
                      rows={4}
                      value={String(selected.data.text ?? "")}
                      onFocus={armEditGesture}
                      onChange={(e) => patchSelected({ text: e.target.value }, true)}
                      placeholder="רשות. המוצר עצמו נמשך מטאב מוצרים."
                      className="mt-1 w-full resize-none rounded-2xl border border-zinc-200 bg-zinc-50/60 px-3 py-2 text-sm text-zinc-800 outline-none focus:border-[#7133da]/40"
                    />
                  </label>
                ) : null}
                {selected.type === "message" ? (
                  <div className="space-y-2">
                    <div className="text-sm text-zinc-700">תמונה או סרטון</div>
                    <input
                      ref={mediaInputRef}
                      type="file"
                      accept="image/jpeg,image/png,.jpg,.jpeg,.png,video/mp4,video/3gpp,.mp4,.3gp,.3gpp"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (!file || !selected) return;
                        const nodeId = selected.id;
                        setMediaError("");
                        setMediaUploading(true);
                        void uploadDashboardWhatsAppMedia(file)
                          .then((uploaded) => {
                            remember();
                            setDirty(true);
                            setNodes((current) =>
                              current.map((node) =>
                                node.id === nodeId
                                  ? { ...node, data: { ...node.data, media_url: uploaded.url, media_kind: uploaded.kind } }
                                  : node
                              )
                            );
                          })
                          .catch((uploadError: unknown) => {
                            setMediaError(uploadError instanceof Error ? uploadError.message : "ההעלאה נכשלה.");
                          })
                          .finally(() => setMediaUploading(false));
                      }}
                    />
                    {String(selected.data.media_url ?? "").trim() ? (
                      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50">
                        {selected.data.media_kind === "video" ? (
                          <video
                            src={`${String(selected.data.media_url).split("#")[0]}#t=0.001`}
                            className="max-h-36 w-full bg-black object-contain"
                            muted
                            playsInline
                          />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={String(selected.data.media_url)} alt="" className="max-h-36 w-full object-contain" />
                        )}
                      </div>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={mediaUploading}
                        onClick={() => mediaInputRef.current?.click()}
                        className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 disabled:opacity-50"
                      >
                        {mediaUploading ? "מעלה…" : String(selected.data.media_url ?? "").trim() ? "החלפת קובץ" : "הוספת קובץ"}
                      </button>
                      {String(selected.data.media_url ?? "").trim() ? (
                        <button
                          type="button"
                          onClick={() => patchSelected({ media_url: "", media_kind: "" })}
                          className="rounded-full px-3 py-1.5 text-sm text-zinc-500"
                        >
                          הסרה
                        </button>
                      ) : null}
                    </div>
                    {mediaError ? <p className="text-xs text-red-600">{mediaError}</p> : null}
                    <p className="text-xs leading-relaxed text-zinc-500">
                      JPG או PNG עד 5MB. סרטון MP4 או 3GP עד 16MB, עם קידוד H.264 ושמע AAC. הטקסט נשלח ככיתוב על הקובץ
                      {selected.data.text && [...String(selected.data.text)].length > WHATSAPP_MEDIA_CAPTION_MAX_CHARS
                        ? ", ומעל 1024 תווים הוא נשלח גם כהודעה נפרדת"
                        : ""}
                      .
                    </p>
                  </div>
                ) : null}
                {selected.type === "question" ? (
                  <div className="space-y-2">
                    <div className="text-sm text-zinc-700">
                      כפתורים <span className="text-xs font-normal text-zinc-400">עד {WA_REPLY_BUTTON_TITLE_MAX_CHARS} תווים</span>
                    </div>
                    {(selected.data.buttons ?? [""]).slice(0, MAX_NODE_BUTTONS).map((label, i) => (
                      <input
                        key={i}
                        value={label}
                        onFocus={armEditGesture}
                        maxLength={WA_REPLY_BUTTON_TITLE_MAX_CHARS}
                        onChange={(e) => {
                          const buttons = [...(selected.data.buttons ?? [])].slice(0, MAX_NODE_BUTTONS);
                          buttons[i] = clampWaReplyButtonTitle(e.target.value);
                          patchSelected({ buttons }, true);
                        }}
                        placeholder={`כפתור ${i + 1}`}
                        className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
                      />
                    ))}
                    {(selected.data.buttons ?? []).length < MAX_NODE_BUTTONS ? (
                      <button
                        type="button"
                        onClick={() => patchSelected({ buttons: [...(selected.data.buttons ?? []), ""].slice(0, MAX_NODE_BUTTONS) })}
                        className="text-sm font-medium text-[#7133da]"
                      >
                        הוסיפי כפתור
                      </button>
                    ) : (
                      <p className="text-xs text-zinc-400">עד 10 כפתורים</p>
                    )}
                  </div>
                ) : null}
                {selected.type === "daytime" ? (
                  <div className="space-y-2">
                    <p className="text-sm leading-relaxed text-zinc-500">
                      המועדים נמשכים מלוח המועדים של המוצר בטאב מוצרים. אין כאן בחירה ידנית.
                    </p>
                    {(daytimeSlots.get(selected.id) ?? []).length ? (
                      <ul className="space-y-1 text-sm text-zinc-800">
                        {(daytimeSlots.get(selected.id) ?? []).map((label, i) => (
                          <li key={`${label}-${i}`}>{label}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-zinc-400">אין מועדי לוח למוצר שנבחר.</p>
                    )}
                    {(daytimeSlots.get(selected.id) ?? []).length > MAX_NODE_BUTTONS ? (
                      <p className="text-xs text-zinc-400">בוואטסאפ נשלחים 10 המועדים הראשונים.</p>
                    ) : null}
                  </div>
                ) : null}
                {selected.type === "details" ? (
                  <p className="text-xs leading-relaxed text-zinc-500">
                    הליד עונה בטקסט חופשי. אחרי התשובה נשלח «קיבלנו את הפרטים, תודה!» והמסלול ממשיך לתיבה הבאה.
                  </p>
                ) : null}
                {selected.type === "followup" ? (
                  <div className="space-y-2">
                    <label className="block text-sm text-zinc-700">
                      השהייה בלי מענה
                      <div className="mt-1 flex gap-2">
                        <input
                          type="number"
                          min={1}
                          value={
                            delayMinutesOf(selected.data) % 60 === 0
                              ? delayMinutesOf(selected.data) / 60
                              : delayMinutesOf(selected.data)
                          }
                          onChange={(e) => {
                            const amount = Math.max(1, Number(e.target.value) || 1);
                            const asHours = delayMinutesOf(selected.data) >= 60 && delayMinutesOf(selected.data) % 60 === 0;
                            const minutes = asHours ? amount * 60 : amount;
                            patchSelected({ delay_minutes: Math.min(7 * 24 * 60, Math.max(5, minutes)) });
                          }}
                          className="w-24 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
                        />
                        <select
                          value={delayMinutesOf(selected.data) >= 60 && delayMinutesOf(selected.data) % 60 === 0 ? "hours" : "minutes"}
                          onChange={(e) => {
                            const minutes = delayMinutesOf(selected.data);
                            const asHours = e.target.value === "hours";
                            const amount = asHours ? Math.max(1, Math.round(minutes / 60)) : minutes;
                            patchSelected({ delay_minutes: asHours ? amount * 60 : Math.max(5, amount) });
                          }}
                          className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
                        >
                          <option value="minutes">דקות</option>
                          <option value="hours">שעות</option>
                        </select>
                      </div>
                    </label>
                    <p className="text-xs leading-relaxed text-zinc-500">
                      נשלח רק למי שנמצא על התיבה שמחוברת בקו «אין מענה», ורק אם לא ענה עד סוף ההשהייה. מינימום 5 דקות.
                    </p>
                  </div>
                ) : null}
                {selected.type === "product" ? (
                  <label className="block text-sm text-zinc-700">
                    מוצר מטאב מוצרים
                    <select
                      value={String(selected.data.product_slug ?? "")}
                      onChange={(e) => patchSelected({ product_slug: e.target.value })}
                      className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
                    >
                      <option value="">בחרי מוצר</option>
                      {products.map((product) => (
                        <option key={product.slug} value={product.slug}>
                          {product.name || product.slug}
                        </option>
                      ))}
                    </select>
                    {productName ? <span className="mt-1 block text-xs text-zinc-500">{productName}</span> : null}
                  </label>
                ) : null}
                {selected.type === "register" ? (
                  <p className="text-xs leading-relaxed text-zinc-500">
                    {"{מוצר}"} נמשך מתיבת המוצר. {"{יום}"} ו{"{שעה}"} נמשכים מהמועד שנבחר מלוח המועדים. אחרי השליחה נשלחת לבעלת העסק הודעת וואטסאפ על הרשמה לאימון ניסיון.
                  </p>
                ) : null}
              </div>
            )}
            <p className="mt-4 text-xs text-zinc-400">
              {status === "saving" ? "שומר…" : status === "error" ? error : dirty ? "יש שינויים שלא נשמרו" : "נשמר"}
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}

export default function ConversationFlowBuilder({ slug }: { slug: string }) {
  return (
    <ReactFlowProvider>
      <ConversationFlowCanvas slug={slug} />
    </ReactFlowProvider>
  );
}
