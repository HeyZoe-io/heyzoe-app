"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Loader2 } from "lucide-react";

type FlowType = "message" | "question" | "product" | "register";
type Capture = "none" | "day" | "time";

type FlowData = {
  text?: string;
  buttons?: string[];
  capture?: Capture;
  product_slug?: string;
};

type ProductOption = { slug: string; name: string };

const TYPE_LABEL: Record<FlowType, string> = {
  message: "הודעה",
  question: "שאלה",
  product: "מוצר",
  register: "אישור הרשמה",
};

function newId() {
  return crypto.randomUUID();
}

function cardStyle(selected: boolean): CSSProperties {
  return {
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

function FlowNodeCard({ data, selected, type }: NodeProps<Node<FlowData, FlowType>>) {
  const d = data ?? {};
  const buttons = Array.isArray(d.buttons) ? d.buttons : [];
  return (
    <div style={cardStyle(Boolean(selected))}>
      <Handle type="target" position={Position.Right} style={{ background: "#7133da" }} />
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.2, color: "#7133da", marginBottom: 3 }}>{TYPE_LABEL[type]}</div>
      <div
        style={{
          fontSize: 10,
          color: "#3f3f46",
          lineHeight: 1.3,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {String(d.text || "").trim() || "טקסט ריק"}
      </div>
      {type === "product" ? (
        <div style={{ marginTop: 4, fontSize: 9, color: "#71717a" }}>{d.product_slug ? "מוצר נבחר" : "בחרי מוצר"}</div>
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
        : (
          <Handle type="source" position={Position.Left} id="out" style={{ background: "#7133da" }} />
        )}
    </div>
  );
}

const nodeTypes = {
  message: FlowNodeCard,
  question: FlowNodeCard,
  product: FlowNodeCard,
  register: FlowNodeCard,
};

function starterNodes(): Node<FlowData, FlowType>[] {
  return [
    {
      id: newId(),
      type: "question",
      position: { x: 420, y: 80 },
      data: { text: "", buttons: ["", ""], capture: "none" },
    },
  ];
}

function ConversationFlowCanvas({ slug }: { slug: string }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<FlowData, FlowType>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "saving" | "error">("loading");
  const [error, setError] = useState("");
  const saveTimer = useRef<number | null>(null);
  const ready = useRef(false);

  const selected = nodes.find((n) => n.id === selectedId) ?? null;

  const load = useCallback(async () => {
    setStatus("loading");
    setError("");
    try {
      const res = await fetch(`/api/dashboard/conversation-flow?slug=${encodeURIComponent(slug)}`, { cache: "no-store" });
      const json = (await res.json()) as {
        nodes?: Array<{ id: string; type: FlowType; data: FlowData; position_x: number; position_y: number }>;
        edges?: Array<{ id: string; source_node_id: string; target_node_id: string; source_handle: string }>;
        products?: ProductOption[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || "load_failed");
      setProducts(json.products ?? []);
      const loadedNodes = (json.nodes ?? []).map((n) => ({
        id: n.id,
        type: n.type,
        position: { x: n.position_x, y: n.position_y },
        data: n.data ?? {},
      }));
      setNodes(loadedNodes.length ? loadedNodes : starterNodes());
      setEdges(
        (json.edges ?? []).map((e) => ({
          id: e.id,
          source: e.source_node_id,
          target: e.target_node_id,
          sourceHandle: e.source_handle || "out",
        }))
      );
      setStatus("ready");
      ready.current = true;
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
      setStatus("ready");
      setError("");
    },
    [slug]
  );

  useEffect(() => {
    if (!ready.current) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void persist(nodes, edges);
    }, 700);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [nodes, edges, persist]);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((current) => addEdge({ ...connection, sourceHandle: connection.sourceHandle || "out" }, current)),
    [setEdges]
  );

  function addNode(type: FlowType) {
    const id = newId();
    const data: FlowData =
      type === "question"
        ? { text: "", buttons: ["", ""], capture: "none" }
        : type === "register"
          ? { text: "" }
          : type === "product"
            ? { text: "", product_slug: "" }
            : { text: "" };
    setNodes((current) => [
      ...current,
      { id, type, position: { x: 80 + current.length * 24, y: 80 + current.length * 28 }, data },
    ]);
    setSelectedId(id);
  }

  function patchSelected(patch: Partial<FlowData>) {
    if (!selected) return;
    setNodes((current) => current.map((n) => (n.id === selected.id ? { ...n, data: { ...n.data, ...patch } } : n)));
  }

  const productName = useMemo(() => {
    const slugValue = String(selected?.data.product_slug ?? "");
    return products.find((p) => p.slug === slugValue)?.name ?? "";
  }, [products, selected]);

  return (
    <div className="w-full text-right [&_input]:!text-right [&_textarea]:!text-right" dir="rtl">
      <div className="flex h-[calc(100dvh-10.5rem)] min-h-[680px] flex-col overflow-hidden rounded-3xl border border-zinc-200/80 bg-white shadow-sm">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3 sm:px-5">
          <div>
            <h2 className="text-base font-semibold text-zinc-900">שיחה</h2>
            <p className="mt-0.5 text-sm text-zinc-500">הודעות, שאלות, מוצר ואישור הרשמה. הפולואפים נשארים בדף פולואפ.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(TYPE_LABEL) as FlowType[]).map((type) => (
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
          <div className="relative h-[520px] min-h-0 overflow-hidden bg-[#fafafa] lg:h-full">
            {status === "loading" ? (
              <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
                טוען את השיחה…
              </div>
            ) : (
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
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
            )}
          </div>
          <aside className="border-t border-zinc-100 p-4 lg:border-s lg:border-t-0">
            {!selected ? (
              <p className="text-sm leading-relaxed text-zinc-500">בחרי נוד כדי לערוך את הטקסט. מכל כפתור בשאלה יוצא חץ לענף אחר.</p>
            ) : (
              <div className="space-y-3">
                <div className="text-sm font-semibold text-zinc-900">{TYPE_LABEL[selected.type as FlowType]}</div>
                {selected.type !== "product" ? (
                  <label className="block text-sm text-zinc-700">
                    טקסט
                    <textarea
                      rows={5}
                      value={String(selected.data.text ?? "")}
                      onChange={(e) => patchSelected({ text: e.target.value })}
                      placeholder={selected.type === "register" ? "רשמתי אותך ל{מוצר} ב{יום} בשעה {שעה}." : "כתבי את ההודעה"}
                      className="mt-1 w-full resize-none rounded-2xl border border-zinc-200 bg-zinc-50/60 px-3 py-2 text-sm text-zinc-800 outline-none focus:border-[#7133da]/40"
                    />
                  </label>
                ) : (
                  <label className="block text-sm text-zinc-700">
                    טקסט לפני המעבר
                    <textarea
                      rows={4}
                      value={String(selected.data.text ?? "")}
                      onChange={(e) => patchSelected({ text: e.target.value })}
                      placeholder="רשות. המוצר עצמו נמשך מטאב מוצרים."
                      className="mt-1 w-full resize-none rounded-2xl border border-zinc-200 bg-zinc-50/60 px-3 py-2 text-sm text-zinc-800 outline-none focus:border-[#7133da]/40"
                    />
                  </label>
                )}
                {selected.type === "question" ? (
                  <div className="space-y-2">
                    <div className="text-sm text-zinc-700">כפתורים</div>
                    {(selected.data.buttons ?? [""]).map((label, i) => (
                      <input
                        key={i}
                        value={label}
                        onChange={(e) => {
                          const buttons = [...(selected.data.buttons ?? [])];
                          buttons[i] = e.target.value;
                          patchSelected({ buttons });
                        }}
                        placeholder={`כפתור ${i + 1}`}
                        className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
                      />
                    ))}
                    <button
                      type="button"
                      onClick={() => patchSelected({ buttons: [...(selected.data.buttons ?? []), ""] })}
                      className="text-sm font-medium text-[#7133da]"
                    >
                      הוסיפי כפתור
                    </button>
                    <label className="block text-sm text-zinc-700">
                      התשובה נשמרת כ
                      <select
                        value={selected.data.capture ?? "none"}
                        onChange={(e) => patchSelected({ capture: e.target.value as Capture })}
                        className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm"
                      >
                        <option value="none">בלי שמירה</option>
                        <option value="day">יום</option>
                        <option value="time">שעה</option>
                      </select>
                    </label>
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
                    {"{מוצר}"} נמשך מנוד המוצר ומטאב מוצרים. {"{יום}"} ו{"{שעה}"} נמשכים משאלות שסימנת כיום או כשעה. אחרי השליחה נשלחת לבעלת העסק הודעת וואטסאפ על הרשמה לאימון ניסיון.
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setNodes((current) => current.filter((n) => n.id !== selected.id));
                    setEdges((current) => current.filter((e) => e.source !== selected.id && e.target !== selected.id));
                    setSelectedId(null);
                  }}
                  className="text-sm text-rose-600"
                >
                  מחקי נוד
                </button>
              </div>
            )}
            <p className="mt-4 text-xs text-zinc-400">
              {status === "saving" ? "שומר…" : status === "error" ? error : "נשמר אוטומטית"}
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
