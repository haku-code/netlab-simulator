"use client";

import clsx from "clsx";
import { Monitor, Plug, Printer, Server, Smartphone, Tv } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { CLIENT_KIND_LABEL } from "@/components/icons";
import { ApWifi } from "@/components/panels/DevicePanel";
import { Button, Card, KV, PageHeader, Segmented, Select, Status, Term } from "@/components/ui";
import { quality, roomAt, rssiAt, autoFloor, type Band, type FloorTemplate } from "@/lib/floor";
import { FLOOR_PRESETS } from "@/lib/floor-templates";
import { netInfo } from "@/lib/emu";
import { useClientStates } from "@/lib/hooks";
import type { ClientKind, XY } from "@/lib/model";
import { broadcasts } from "@/lib/net/simulate";
import { useStore } from "@/lib/store";
import { useWindows } from "@/lib/windows";

const KIND_ICON: Record<ClientKind, typeof Monitor> = { pc: Monitor, phone: Smartphone, iot: Plug, server: Server, printer: Printer, tv: Tv };
const FLOOR_OPTIONS = Object.entries(FLOOR_PRESETS).map(([value, { layout }]) => ({ value, label: layout.name }));

/** 受信強度 → ヒートマップの色 */
function heat(rssi: number) {
  if (rssi >= -55) return "rgba(56,178,97,0.42)";
  if (rssi >= -65) return "rgba(132,204,22,0.36)";
  if (rssi >= -72) return "rgba(250,204,21,0.32)";
  if (rssi >= -80) return "rgba(249,115,22,0.26)";
  return null;
}

type Sel = { kind: "client" | "device"; id: string } | null;

export default function FloorPlanPage() {
  const s = useStore((x) => x.scenario);
  const mutate = useStore((x) => x.mutate);
  const states = useClientStates();
  const openWindow = useWindows((w) => w.open);
  const svgRef = useRef<SVGSVGElement>(null);
  const [band, setBand] = useState<Band | "off">("5");
  const [ssidFilter, setSsidFilter] = useState("all");
  const [pendingTemplate, setPendingTemplate] = useState<FloorTemplate | null>(null);
  const [sel, setSel] = useState<Sel>(null);
  const [drag, setDrag] = useState<{ kind: "client" | "device"; id: string; pos: XY; moved: boolean } | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("client")) setSel({ kind: "client", id: p.get("client")! });
    else if (p.get("ap")) setSel({ kind: "device", id: p.get("ap")! });
  }, []);

  const f = s.floor;
  // ドラッグ中の位置を反映した機器一覧
  const devices = s.devices.map((d) => (drag?.kind === "device" && drag.id === d.id ? { ...d, pos: drag.pos } : d));
  const clients = s.clients.map((c) => (drag?.kind === "client" && drag.id === c.id ? { ...c, pos: drag.pos } : c));
  const aps = devices.filter((d) => d.type === "ap" && d.pos);
  const heatAps = ssidFilter === "all" ? aps : aps.filter((ap) => broadcasts(s.ssids.find((w) => w.id === ssidFilter)!, ap.id));

  const cells = useMemo(() => {
    if (!f || band === "off") return [];
    const out: { x: number; y: number; w: number; h: number; c: string }[] = [];
    // 広い間取りではセルを大きくし、ドラッグ中の再計算を軽くする。
    const step = Math.max(0.5, Math.ceil(Math.sqrt((f.width * f.height) / 1800) * 2) / 2);
    for (let x = 0; x < f.width; x += step)
      for (let y = 0; y < f.height; y += step) {
        const w = Math.min(step, f.width - x);
        const h = Math.min(step, f.height - y);
        const p = { x: x + w / 2, y: y + h / 2 };
        const best = Math.max(-120, ...heatAps.map((ap) => rssiAt(f, ap, p, band)));
        const c = heat(best);
        if (c) out.push({ x, y, w, h, c });
      }
    return out;
  }, [f, band, heatAps.map((a) => `${a.id}:${a.pos!.x.toFixed(1)},${a.pos!.y.toFixed(1)}:${a.txPower}`).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!f) {
    return (
      <>
        <PageHeader title="フロアプラン" />
        <Card className="p-6 text-center">
          <p className="mb-3 text-muted">間取りがまだありません。</p>
          <Button variant="primary" onClick={() => mutate((sc) => autoFloor(sc))}>
            間取りを作成
          </Button>
        </Card>
      </>
    );
  }

  // 文字やアイコンの大きさは間取りの幅に比例させる（家でもオフィスでも見た目が同じになる）
  const u = f.width / 20;
  const padding = Math.max(0.6, 0.75 * u);
  const toSvg = (e: React.PointerEvent): XY => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: Math.min(f.width - 0.3, Math.max(0.3, p.x)), y: Math.min(f.height - 0.3, Math.max(0.3, p.y)) };
  };
  const startDrag = (kind: "client" | "device", id: string, pos: XY) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setDrag({ kind, id, pos, moved: false });
  };
  const onMove = (e: React.PointerEvent) => drag && setDrag({ ...drag, pos: toSvg(e), moved: true });
  const onUp = () => {
    if (!drag) return;
    if (drag.moved)
      mutate((sc) => {
        const item = drag.kind === "client" ? sc.clients.find((c) => c.id === drag.id) : sc.devices.find((d) => d.id === drag.id);
        if (item) item.pos = { x: Math.round(drag.pos.x * 10) / 10, y: Math.round(drag.pos.y * 10) / 10 };
      });
    setSel({ kind: drag.kind, id: drag.id });
    setDrag(null);
  };

  const selClient = sel?.kind === "client" ? clients.find((c) => c.id === sel.id) : undefined;
  const selDevice = sel?.kind === "device" ? devices.find((d) => d.id === sel.id) : undefined;
  const selState = selClient ? states.get(selClient.id) : undefined;
  const selAp = selState?.attachDeviceId && selClient?.connection.type === "wifi" ? devices.find((d) => d.id === selState.attachDeviceId) : undefined;
  const selInfo = selClient ? netInfo(s, selClient.id) : undefined;

  return (
    <>
      <PageHeader title="フロアプラン">
        <label>
          <span className="sr-only">間取り</span>
          <Select
            className="w-60 max-w-[45vw]"
            value={pendingTemplate ?? f.template}
            onChange={(v) => setPendingTemplate(v === f.template ? null : v as FloorTemplate)}
            options={FLOOR_OPTIONS}
          />
        </label>
        <Term id="floor" />
      </PageHeader>

      {pendingTemplate && pendingTemplate !== f.template && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface p-3 text-[12px]">
          <span className="mr-auto text-fg-2">間取りを切り替えると、機器と端末を自動で配置し直します。</span>
          <Button onClick={() => setPendingTemplate(null)}>キャンセル</Button>
          <Button variant="primary" onClick={() => {
            mutate((sc) => autoFloor(sc, pendingTemplate));
            setPendingTemplate(null);
          }}>
            間取りを適用
          </Button>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="text-[12px] text-muted">電波ヒートマップ</span>
        <Segmented<Band | "off">
          value={band}
          onChange={setBand}
          options={[
            { value: "2.4", label: "2.4 GHz" },
            { value: "5", label: "5 GHz" },
            { value: "6", label: "6 GHz" },
            { value: "off", label: "Off" },
          ]}
        />
        <Select className="w-52" value={ssidFilter} onChange={setSsidFilter} options={[{ value: "all", label: "すべての AP" }, ...s.ssids.map((w) => ({ value: w.id, label: `SSID: ${w.name} の範囲` }))]} />
        <span className="flex items-center gap-2 text-[11.5px] text-muted">
          {[
            ["rgba(56,178,97,0.7)", "≥ −55"],
            ["rgba(132,204,22,0.7)", "≥ −65"],
            ["rgba(250,204,21,0.7)", "≥ −72"],
            ["rgba(249,115,22,0.7)", "≥ −80 dBm"],
          ].map(([c, l]) => (
            <span key={l} className="inline-flex items-center gap-1">
              <span className="size-2.5 rounded-sm" style={{ background: c }} />
              {l}
            </span>
          ))}
        </span>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="overflow-hidden p-3">
          <svg
            ref={svgRef}
            viewBox={`${-padding} ${-padding} ${f.width + 2 * padding} ${f.height + 2 * padding}`}
            className="w-full touch-none select-none"
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerDown={() => setSel(null)}
          >
            {/* 部屋 */}
            {f.rooms.map((r) => (
              <g key={r.id}>
                <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="var(--surface-2)" stroke="var(--fg-2)" strokeWidth={0.12} />
                <text x={r.x + 0.3 * u} y={r.y + 0.6 * u} fontSize={0.42 * u} fill="var(--muted)" fontWeight={600}>
                  {r.name}
                </text>
              </g>
            ))}
            {cells.map((c, i) => (
              <rect key={i} x={c.x} y={c.y} width={c.w} height={c.h} fill={c.c} />
            ))}
            {/* 選択中の端末 → 接続中の AP */}
            {selClient?.pos && selAp?.pos && (
              <g>
                <line x1={selClient.pos.x} y1={selClient.pos.y} x2={selAp.pos.x} y2={selAp.pos.y} stroke="var(--accent)" strokeWidth={0.06 * u} strokeDasharray={`${0.25 * u} ${0.18 * u}`} />
                <text x={(selClient.pos.x + selAp.pos.x) / 2} y={(selClient.pos.y + selAp.pos.y) / 2 - 0.25 * u} fontSize={0.3 * u} fill="var(--accent)" fontWeight={700} textAnchor="middle">
                  {selInfo?.radio?.split(" · ").slice(1, 4).join(" · ")}
                </text>
              </g>
            )}
            {/* ゲートウェイ・スイッチ */}
            {devices
              .filter((d) => d.type !== "ap" && d.pos)
              .map((d, i) => (
                <g key={d.id} onPointerDown={startDrag("device", d.id, d.pos!)} className="cursor-grab">
                  <rect x={d.pos!.x - 0.45 * u} y={d.pos!.y - 0.22 * u} width={0.9 * u} height={0.44 * u} rx={0.06 * u} fill="var(--surface)" stroke={sel?.id === d.id ? "var(--accent)" : "var(--faint)"} strokeWidth={0.05 * u} />
                  <text x={d.pos!.x} y={d.pos!.y + (i % 2 ? -0.45 : 0.62) * u} fontSize={0.26 * u} textAnchor="middle" fill="var(--fg-2)">
                    {d.name}
                  </text>
                </g>
              ))}
            {/* AP */}
            {aps.map((ap) => (
              <g key={ap.id} onPointerDown={startDrag("device", ap.id, ap.pos!)} className="cursor-grab">
                <circle cx={ap.pos!.x} cy={ap.pos!.y} r={0.42 * u} fill="var(--surface)" stroke={sel?.id === ap.id ? "var(--accent)" : "var(--faint)"} strokeWidth={(sel?.id === ap.id ? 0.1 : 0.06) * u} />
                <circle cx={ap.pos!.x} cy={ap.pos!.y} r={0.17 * u} fill="none" stroke="var(--accent)" strokeWidth={0.06 * u} />
                <text x={ap.pos!.x} y={ap.pos!.y - 0.6 * u} fontSize={0.3 * u} fontWeight={600} textAnchor="middle" fill="var(--fg)">
                  {ap.name}
                </text>
              </g>
            ))}
            {/* 端末 */}
            {clients
              .filter((c) => c.pos)
              .map((c) => {
                const st = states.get(c.id);
                const Icon = KIND_ICON[c.kind];
                const ok = !st?.error;
                return (
                  <g key={c.id} onPointerDown={startDrag("client", c.id, c.pos!)} className="cursor-grab">
                    <circle cx={c.pos!.x} cy={c.pos!.y} r={0.32 * u} fill="var(--surface)" stroke={sel?.id === c.id ? "var(--accent)" : ok ? "var(--ok)" : "var(--err)"} strokeWidth={(sel?.id === c.id ? 0.09 : 0.05) * u} />
                    <Icon x={c.pos!.x - 0.18 * u} y={c.pos!.y - 0.18 * u} width={0.36 * u} height={0.36 * u} strokeWidth={2} color="var(--fg-2)" />
                    <text x={c.pos!.x} y={c.pos!.y + 0.62 * u} fontSize={0.24 * u} textAnchor="middle" fill="var(--fg-2)">
                      {c.name}
                    </text>
                  </g>
                );
              })}
          </svg>
          <div className="mt-2 space-y-1 px-1 text-[12px] text-muted">
            <p>{f.width} × {f.height} m · {FLOOR_PRESETS[f.template].material} · 壁 1 枚の減衰（2.4 GHz −{f.wallLoss["2.4"]} dB / 5 GHz −{f.wallLoss["5"]} dB / 6 GHz −{f.wallLoss["6"]} dB）</p>
            <p>AP や端末はドラッグで移動できます。無線端末は、接続中の SSID を配信する AP のうち電波が最も強いものに自動で接続します。</p>
          </div>
        </Card>

        <div className="space-y-4">
          {selClient && selState ? (
            <Card title={selClient.name} action={<span className="text-[12px] text-muted">{CLIENT_KIND_LABEL[selClient.kind]}</span>}>
              <div className="space-y-3 px-4 pb-4">
                <Status ok={!selState.error} label={selState.error ? "接続に問題があります" : "オンライン"} />
                {selState.error && <p className="text-[12.5px] text-err">{selState.error}</p>}
                <KV
                  rows={[
                    ["場所", selClient.pos ? (roomAt(f, selClient.pos)?.name ?? "—") : "—"],
                    ["接続", selClient.connection.type === "wired" ? "有線" : (selInfo?.ssidName ?? "未接続")],
                    ...(selClient.connection.type === "wifi"
                      ? ([
                          ["AP", selAp?.name ?? "—"],
                          ["電波", selInfo?.radio ? selInfo.radio.split(" · ").slice(1).join(" · ") : "—"],
                          ["品質", selInfo?.wifi ? quality(selInfo.wifi.rssi).label : "—"],
                        ] as [string, string][])
                      : []),
                    ["IP", selState.ip ?? "—"],
                  ]}
                />
                <div className="flex gap-2">
                  <Button variant="primary" onClick={() => openWindow(selClient.id)}>
                    端末を操作する
                  </Button>
                  <Link href={`/clients?id=${selClient.id}`}>
                    <Button>詳細</Button>
                  </Link>
                </div>
              </div>
            </Card>
          ) : selDevice?.type === "ap" ? (
            <Card title={selDevice.name} action={<span className="text-[12px] text-muted">{selDevice.pos ? roomAt(f, selDevice.pos)?.name : ""}</span>}>
              <div className="px-4 pb-4">
                <ApWifi apId={selDevice.id} />
              </div>
            </Card>
          ) : (
            <Card className="p-4 text-[12.5px] text-muted">
              端末や AP をクリックすると詳細が表示されます。端末を AP から離したり、壁の向こうに動かしたりして、電波と接続先 AP の変化を確かめましょう。
            </Card>
          )}
          <Card title="AP の電波が届く範囲">
            <ul className="divide-y divide-line-soft px-4 pb-2 text-[12.5px]">
              {aps.map((ap) => (
                <li key={ap.id} className="flex items-center justify-between py-2">
                  <button onClick={() => setSel({ kind: "device", id: ap.id })} className={clsx("font-medium hover:text-accent", sel?.id === ap.id && "text-accent")}>
                    {ap.name}
                  </button>
                  <span className="text-muted">
                    {roomAt(f, ap.pos!)?.name} · 出力 {{ high: "高", medium: "中", low: "低" }[ap.txPower ?? "high"]} · {s.ssids.filter((w) => broadcasts(w, ap.id)).map((w) => w.name).join(", ") || "配信なし"}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
