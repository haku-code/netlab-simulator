"use client";

import "@xyflow/react/dist/style.css";
import { switchingState } from "@/lib/net/switching";
import { BaseEdge, Controls, EdgeLabelRenderer, Handle, Position, ReactFlow, getSmoothStepPath, type Edge, type EdgeProps, type Node, type NodeProps } from "@xyflow/react";
import clsx from "clsx";
import { Cable, Globe, Wifi } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useClientStates } from "@/lib/hooks";
import { type ClientKind, type DeviceType, type Scenario } from "@/lib/model";
import { findGateway, type Segment } from "@/lib/net/simulate";
import { meshEdgeId, meshParent } from "@/lib/net/wifi-radio";
import { useStore } from "@/lib/store";
import { useWindows } from "@/lib/windows";
import { ClientIcon, DeviceGlyph } from "../icons";

export interface Highlight {
  deviceIds: string[];
  linkIds: string[];
  clientIds: string[];
  failLinkIds: string[];
  ok: boolean;
  segments?: Segment[];
  failAt?: string | null;
}

type HL = "on" | "off" | null;

export type ConnectionSelection =
  | { kind: "client-connection"; id: string; targetDeviceId?: string }
  | { kind: "port-connection"; id: string; portId: string };

type DeviceData = { name: string; sub: string; type: DeviceType; hl: HL; selected: boolean; blocked?: boolean; acceptsCable?: boolean; dragOver?: boolean };
type ClientData = {
  name: string; sub: string; kind: ClientKind; wireless: boolean; ok: boolean; hl: HL; selected: boolean; blocked?: boolean;
  edit?: (targetDeviceId?: string) => void;
  setDragTarget?: (id: string | null) => void;
};
type Packet = { index: number; total: number; reversed: boolean; label: string; fail: boolean };
type NetEdgeData = { packets?: Packet[] };

const SEG_SEC = 0.75;

function PacketDot({ path, p }: { path: string; p: Packet }) {
  // 1 周 = 全区間 + 休止 1 区間分。各区間は自分の時間帯だけ表示される
  const n = p.total + 1;
  const cycle = n * SEG_SEC;
  const a = p.index / n;
  const b = (p.index + 1) / n;
  const end = p.fail ? 0.5 : 1;
  const points = p.reversed ? `1;1;${1 - end};${1 - end}` : `0;0;${end};${end}`;
  return (
    <circle r={4.5} fill={p.fail ? "var(--err)" : "var(--accent)"} stroke="var(--surface)" strokeWidth={1.5} opacity={0}>
      <animateMotion dur={`${cycle}s`} repeatCount="indefinite" path={path} keyPoints={points} keyTimes={`0;${a};${b};1`} calcMode="linear" />
      <animate
        attributeName="opacity"
        dur={`${cycle}s`}
        repeatCount="indefinite"
        values={p.fail ? "0;1;1;0" : "0;1;0"}
        keyTimes={p.fail ? `0;${a};${b};${Math.min(1, b + 0.5 / n)}` : `0;${a};${b}`}
        calcMode="discrete"
      />
    </circle>
  );
}

/** パケットが順番に流れるエッジ。区間ごとに VLAN タグの状態をラベル表示する */
function NetEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, data }: EdgeProps<Edge<NetEdgeData>>) {
  const [path, lx, ly] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const packets = data?.packets ?? [];
  return (
    <>
      <BaseEdge id={id} path={path} style={style} />
      {packets.map((p) => (
        <PacketDot key={p.index} path={path} p={p} />
      ))}
      {packets.length > 0 && (
        <EdgeLabelRenderer>
          <div className="nodrag nopan pointer-events-none absolute flex flex-col items-center gap-0.5" style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}>
            {packets.map((p) => (
              <span
                key={p.index}
                className={clsx(
                  "rounded border bg-surface px-1.5 py-px text-[10px] font-medium whitespace-nowrap",
                  p.fail ? "border-err/50 text-err" : "border-accent/40 text-accent",
                )}
              >
                {p.index + 1}. {p.label}
              </span>
            ))}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const edgeTypes = { net: NetEdge };

const hiddenHandle = "!size-1 !min-h-0 !min-w-0 !border-0";

function DeviceNode({ id, data }: NodeProps<Node<DeviceData>>) {
  return (
    <div
      className={clsx("flex w-[140px] flex-col items-center text-center transition-opacity", data.hl === "off" && "opacity-30")}
      data-topology-wired-device={data.acceptsCable ? id : undefined}
    >
      <Handle type="target" position={Position.Top} className={hiddenHandle} />
      <div
        className={clsx(
          "flex size-14 items-center justify-center rounded-lg border bg-surface transition-colors",
          data.blocked ? "border-err ring-2 ring-err/30" : data.dragOver || data.selected || data.hl === "on" ? "border-accent ring-2 ring-accent/25" : "border-line hover:border-faint",
        )}
      >
        <DeviceGlyph type={data.type} size={38} />
      </div>
      <div className="mt-1.5 max-w-full truncate text-[12px] font-semibold">{data.name}</div>
      <div className="tnum text-[11px] text-muted">{data.sub}</div>
      <Handle type="source" position={Position.Bottom} className={hiddenHandle} />
    </div>
  );
}

function wiredDeviceAt(x: number, y: number) {
  return document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-topology-wired-device]")?.dataset.topologyWiredDevice ?? null;
}

function ClientNode({ data }: NodeProps<Node<ClientData>>) {
  const ConnectionIcon = data.wireless ? Wifi : Cable;
  const start = useRef<{ pointer: number; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  return (
    <div className={clsx("flex w-[96px] flex-col items-center text-center transition-opacity", data.hl === "off" && "opacity-30")}>
      <Handle type="target" position={Position.Top} className={hiddenHandle} />
      <div
        className={clsx(
          "relative flex size-9 items-center justify-center rounded-full border bg-surface text-fg-2 transition-colors",
          data.blocked ? "border-err ring-2 ring-err/30" : data.selected || data.hl === "on" ? "border-accent ring-2 ring-accent/25" : "border-line hover:border-faint",
          data.edit && "nodrag nopan cursor-grab touch-none select-none active:cursor-grabbing",
        )}
        onPointerDown={data.edit ? (e) => {
          if (e.button !== 0 || !e.isPrimary) return;
          suppressClick.current = false;
          start.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY };
          e.currentTarget.setPointerCapture(e.pointerId);
        } : undefined}
        onPointerMove={(e) => {
          const from = start.current;
          if (from?.pointer !== e.pointerId || Math.hypot(e.clientX - from.x, e.clientY - from.y) < 8) return;
          data.setDragTarget?.(wiredDeviceAt(e.clientX, e.clientY));
        }}
        onPointerUp={(e) => {
          const from = start.current;
          if (from?.pointer !== e.pointerId) return;
          start.current = null;
          data.setDragTarget?.(null);
          if (Math.hypot(e.clientX - from.x, e.clientY - from.y) < 8) return;
          suppressClick.current = true;
          const id = wiredDeviceAt(e.clientX, e.clientY);
          if (id) data.edit?.(id);
        }}
        onLostPointerCapture={() => {
          start.current = null;
          data.setDragTarget?.(null);
        }}
        onClickCapture={(e) => {
          if (suppressClick.current && e.detail > 0) e.stopPropagation();
          suppressClick.current = false;
        }}
      >
        <ClientIcon kind={data.kind} size={16} />
        {!data.ok && <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-err ring-2 ring-surface" />}
        {data.edit && (
          <button type="button" title="接続を変更" aria-label={`${data.name}の接続を変更`}
            className="nodrag nopan absolute top-1/2 left-full ml-1 flex size-6 -translate-y-1/2 items-center justify-center rounded border border-line bg-surface text-muted hover:border-accent hover:text-accent focus-visible:outline focus-visible:outline-accent"
            onPointerDown={(e) => { suppressClick.current = false; e.stopPropagation(); }}
            onClick={(e) => { e.stopPropagation(); data.edit?.(); }}
            onDoubleClick={(e) => e.stopPropagation()}
          ><ConnectionIcon size={13} aria-hidden="true" /></button>
        )}
      </div>
      <div className="mt-1 max-w-full truncate text-[11.5px] font-medium">{data.name}</div>
      <div className="tnum text-[10.5px] text-muted">{data.sub}</div>
    </div>
  );
}

function InternetNode() {
  return (
    <div className="flex w-[140px] flex-col items-center">
      <div className="flex size-10 items-center justify-center rounded-full border border-line bg-surface text-accent">
        <Globe size={18} strokeWidth={1.6} />
      </div>
      <div className="mt-1 text-[12px] font-semibold">インターネット</div>
      <Handle type="source" position={Position.Bottom} className={hiddenHandle} />
    </div>
  );
}

const nodeTypes = { device: DeviceNode, client: ClientNode, internet: InternetNode };

const DEV_W = 140;
const CLI_W = 96;
const GAP = 18;

interface TreeNode {
  id: string;
  kind: "device" | "client";
  children: TreeNode[];
  linkId?: string;
  width: number;
}

/** ゲートウェイを根にした物理トポロジーの木を作り、x 座標を割り当てる */
function layout(s: Scenario, parents: ReadonlyMap<string, string>) {
  const gw = findGateway(s);
  const pos = new Map<string, { x: number; y: number }>();
  const parentLink = new Map<string, string>();
  const visited = new Set(gw ? [gw.id] : []);
  const build = (devId: string): TreeNode => {
    const node: TreeNode = { id: devId, kind: "device", children: [], width: DEV_W };
    for (const l of s.links) {
      const other = l.a.deviceId === devId ? l.b.deviceId : l.b.deviceId === devId ? l.a.deviceId : null;
      if (!other || visited.has(other)) continue;
      visited.add(other);
      const child = build(other);
      child.linkId = l.id;
      node.children.push(child);
    }
    for (const ap of s.devices) {
      if (visited.has(ap.id) || meshParent(s, ap)?.id !== devId) continue;
      visited.add(ap.id);
      const child = build(ap.id);
      child.linkId = meshEdgeId(ap.id);
      node.children.push(child);
    }
    for (const c of s.clients) {
      const at = parents.get(c.id);
      if (at === devId) node.children.push({ id: c.id, kind: "client", children: [], width: CLI_W });
    }
    // 機器を先、クライアントを後に並べる
    node.children.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "device" ? -1 : 1));
    const sum = node.children.reduce((w, c) => w + c.width, 0) + GAP * Math.max(0, node.children.length - 1);
    node.width = Math.max(node.width, sum);
    return node;
  };

  const place = (n: TreeNode, left: number, y: number) => {
    const w = n.kind === "device" ? DEV_W : CLI_W;
    pos.set(n.kind === "client" ? `c:${n.id}` : n.id, { x: left + n.width / 2 - w / 2, y });
    if (n.linkId) parentLink.set(n.id, n.linkId);
    const total = n.children.reduce((a, c) => a + c.width, 0) + GAP * Math.max(0, n.children.length - 1);
    let x = left + (n.width - total) / 2;
    for (const c of n.children) {
      place(c, x, y + 150);
      x += c.width + GAP;
    }
  };

  const root = gw ? build(gw.id) : null;
  if (root) {
    place(root, 0, 110);
    pos.set("internet", { x: root.width / 2 - DEV_W / 2, y: 0 });
  }

  // ゲートウェイにつながっていない機器・クライアント
  let x = root ? root.width + 80 : 0;
  for (const d of s.devices.filter((d) => !visited.has(d.id))) {
    pos.set(d.id, { x, y: 110 });
    let cx = x;
    for (const c of s.clients) {
      const at = parents.get(c.id);
      if (at === d.id) {
        pos.set(`c:${c.id}`, { x: cx, y: 260 });
        cx += CLI_W + GAP;
      }
    }
    x = Math.max(x + DEV_W + 60, cx + 60);
  }
  // ケーブルが抜けている端末は右下にまとめる
  let ux = root ? root.width + 80 : 0;
  for (const c of s.clients.filter((c) => !parents.has(c.id))) {
    pos.set(`c:${c.id}`, { x: ux, y: 410 });
    ux += CLI_W + GAP;
  }
  return { pos, parentLink };
}

export function TopologyView({
  highlight,
  selected,
  onSelect,
  onEditConnection,
  className,
  interactive = true,
}: {
  highlight?: Highlight | null;
  selected?: string | null;
  onSelect?: (sel: { kind: "device" | "client"; id: string } | null) => void;
  onEditConnection?: (sel: ConnectionSelection) => void;
  className?: string;
  interactive?: boolean;
}) {
  const s = useStore((x) => x.scenario);
  const theme = useStore((x) => x.theme);
  const states = useClientStates();
  const openWindow = useWindows((w) => w.open);
  const [dragTarget, setDragTarget] = useState<string | null>(null);

  const { nodes, edges } = useMemo(() => {
    const parents = new Map<string, string>();
    const deviceIds = new Set(s.devices.map((d) => d.id));
    for (const c of s.clients) {
      const at = c.connection.type === "wifi" ? states.get(c.id)?.attachDeviceId : c.connection.deviceId;
      if (at && deviceIds.has(at)) parents.set(c.id, at);
    }
    const { pos } = layout(s, parents);
    const hlOf = (on: boolean): HL => (highlight ? (on ? "on" : "off") : null);
    const gw = findGateway(s);

    const nodes: Node[] = [];
    if (gw) nodes.push({ id: "internet", type: "internet", position: pos.get("internet")!, data: {}, selectable: false });
    for (const d of s.devices) {
      nodes.push({
        id: d.id,
        type: "device",
        position: pos.get(d.id) ?? { x: 0, y: 0 },
        data: {
          name: d.name, sub: d.state === "pending" ? "承認待ち" : d.state === "adopting" ? "承認中…" : d.state === "upgrading" ? "更新中…" : switchingState(s).unpowered.has(d.id) ? "給電なし" : d.ip, type: d.type, hl: hlOf(!!highlight?.deviceIds.includes(d.id)), selected: selected === d.id, blocked: highlight?.failAt === d.id,
          acceptsCable: !!onEditConnection && d.type !== "ap" && d.ports.length > 0,
          dragOver: dragTarget === d.id,
        } satisfies DeviceData,
      });
    }
    for (const c of s.clients) {
      const st = states.get(c.id);
      nodes.push({
        id: `c:${c.id}`,
        type: "client",
        position: pos.get(`c:${c.id}`) ?? { x: 0, y: 0 },
        data: {
          name: c.name, sub: st?.ip ?? "—", kind: c.kind, wireless: c.connection.type === "wifi", ok: !st?.error,
          hl: hlOf(!!highlight?.clientIds.includes(c.id)), selected: selected === c.id, blocked: highlight?.failAt === `c:${c.id}`,
          edit: onEditConnection ? (targetDeviceId) => onEditConnection({ kind: "client-connection", id: c.id, targetDeviceId }) : undefined,
          setDragTarget: onEditConnection ? setDragTarget : undefined,
        } satisfies ClientData,
      });
    }

    const stroke = (on?: boolean, fail?: boolean) => ({
      stroke: fail ? "var(--err)" : on ? "var(--accent)" : "var(--faint)",
      strokeWidth: fail || on ? 2 : 1.25,
      opacity: highlight && !on && !fail ? 0.35 : 1,
    });
    const edges: Edge[] = [];
    if (gw) {
      const on = !!highlight?.deviceIds.includes(gw.id) && highlight.ok && highlight.clientIds.length === 1;
      edges.push({ id: "wan", source: "internet", target: gw.id, type: "smoothstep", selectable: false, focusable: false, style: stroke(on) });
    }
    const y = (id: string) => pos.get(id)?.y ?? 0;
    const sw = switchingState(s);
    for (const l of s.links) {
      const [up, down] = y(l.a.deviceId) <= y(l.b.deviceId) ? [l.a, l.b] : [l.b, l.a];
      const on = highlight?.linkIds.includes(l.id);
      const fail = highlight?.failLinkIds.includes(l.id);
      // STP でブロック中は破線、ループ (ストーム) は赤
      const blocked = sw.blocked.has(l.id);
      const storm = sw.stormLinks.has(l.id);
      const base = stroke(on, fail || storm);
      edges.push({
        id: l.id, source: up.deviceId, target: down.deviceId, type: "smoothstep", animated: !!on || storm,
        style: blocked && !on ? { ...base, stroke: "var(--warn)", strokeDasharray: "6 4" } : base,
      });
    }
    for (const c of s.clients) {
      const at = parents.get(c.id);
      if (!at) continue;
      const on = highlight?.clientIds.includes(c.id);
      edges.push({
        id: `ce:${c.id}`,
        source: at,
        target: `c:${c.id}`,
        type: "smoothstep",
        animated: !!on,
        style: { ...stroke(on), strokeDasharray: c.connection.type === "wifi" ? "3 3" : undefined },
      });
    }
    for (const ap of s.devices) {
      const parent = meshParent(s, ap);
      if (!parent) continue;
      const id = meshEdgeId(ap.id);
      const on = highlight?.linkIds.includes(id);
      edges.push({
        id, source: parent.id, target: ap.id, type: "smoothstep",
        selectable: false, focusable: false, style: { ...stroke(on), strokeDasharray: "5 4" },
      });
    }
    // パケットの区間をエッジに割り当てる（往復で同じエッジを通ることもある）
    const segs = highlight?.segments ?? [];
    segs.forEach((seg, i) => {
      const e = edges.find((x) => x.id === seg.edge);
      if (!e) return;
      const packets = (e.data as NetEdgeData | undefined)?.packets ?? [];
      e.data = { packets: [...packets, { index: i, total: segs.length, reversed: e.source !== seg.from, label: seg.label, fail: !!seg.fail }] } satisfies NetEdgeData;
      e.animated = false;
    });
    for (const e of edges) e.type = "net";
    return { nodes, edges };
  }, [s, states, highlight, selected, onEditConnection, dragTarget]);

  return (
    <div className={clsx("h-full w-full", className)}>
      <ReactFlow
        key={`${s.devices.length}-${s.clients.length}-${s.links.length}`}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={interactive}
        panOnDrag={interactive}
        zoomOnScroll={interactive}
        colorMode={theme}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        minZoom={0.25}
        onNodeClick={(_, n) => {
          if (n.id === "internet") return;
          onSelect?.(n.id.startsWith("c:") ? { kind: "client", id: n.id.slice(2) } : { kind: "device", id: n.id });
        }}
        onPaneClick={() => onSelect?.(null)}
        onEdgeClick={onEditConnection ? (_, edge) => {
          if (edge.id === "wan") return;
          if (edge.id.startsWith("ce:")) {
            onEditConnection({ kind: "client-connection", id: edge.id.slice(3) });
            return;
          }
          const link = s.links.find((l) => l.id === edge.id);
          if (!link) return;
          const port = link.a.deviceId === edge.target ? link.a : link.b;
          onEditConnection({ kind: "port-connection", id: port.deviceId, portId: port.portId });
        } : undefined}
        onNodeDoubleClick={(_, n) => n.id.startsWith("c:") && openWindow(n.id.slice(2))}
      >
        {interactive && <Controls showInteractive={false} position="bottom-right" />}
      </ReactFlow>
    </div>
  );
}
