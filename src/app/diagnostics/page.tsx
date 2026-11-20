"use client";

import clsx from "clsx";
import { useMemo, useState } from "react";
import { TopologyView } from "@/components/topology/TopologyView";
import { TraceView } from "@/components/TraceView";
import { Button, Card, Field, Input, PageHeader, Segmented, Select } from "@/components/ui";
import type { Protocol } from "@/lib/model";
import { buildCapture } from "@/lib/capture";
import { trace } from "@/lib/net/simulate";
import { CaptureView } from "@/components/theory/CaptureView";
import { useScenario } from "@/lib/store";

export default function DiagnosticsPage() {
  const s = useScenario();
  const [selectedSrc, setSrc] = useState("");
  const [selectedDst, setDst] = useState("internet");
  const [protocol, setProtocol] = useState<Protocol>("icmp");
  const [port, setPort] = useState("443");
  const [ran, setRan] = useState<{ srcId: string; dst: string } | null>(null);
  const portNum = protocol === "icmp" ? null : Number(port) || null;

  const clientOpts = s.clients.map((c) => ({ value: c.id, label: c.name }));
  const src = s.clients.find((c) => c.id === selectedSrc)?.id ?? s.clients[0]?.id ?? "";
  const dst = s.clients.some((c) => c.id === selectedDst && c.id !== src) ? selectedDst : "internet";
  const nodeName = (id: string) =>
    id === "internet" ? "インターネット" : id.startsWith("c:") ? (s.clients.find((c) => c.id === id.slice(2))?.name ?? "?") : (s.devices.find((d) => d.id === id)?.name ?? "?");
  const run = (srcId = src, destination = dst) => setRan({ srcId, dst: destination });
  const changeSource = (id: string) => {
    if (id === dst) setDst("internet");
    setSrc(id);
  };

  // 設定が変わったら結果を再計算する
  const result = useMemo(() => {
    if (!ran) return null;
    if (!s.clients.some((c) => c.id === ran.srcId) || (ran.dst !== "internet" && !s.clients.some((c) => c.id === ran.dst))) return null;
    return trace(s, { ...ran, protocol, port: portNum });
  }, [s, ran, protocol, portNum]);

  return (
    <>
      <PageHeader title="パケットトレース" />
      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card className="space-y-3 p-4">
            <Field label="送信元">
              <Select value={src} onChange={changeSource} options={clientOpts} disabled={!src} />
            </Field>
            <Field label="宛先">
              <Select value={dst} onChange={setDst} options={[{ value: "internet", label: "インターネット" }, ...clientOpts.filter((o) => o.value !== src)]} />
            </Field>
            <Field label="プロトコル">
              <Segmented<Protocol>
                value={protocol}
                onChange={setProtocol}
                options={[
                  { value: "icmp", label: "ICMP" },
                  { value: "tcp", label: "TCP" },
                  { value: "udp", label: "UDP" },
                ]}
              />
            </Field>
            {protocol !== "icmp" && (
              <Field label="宛先ポート">
                <Input type="number" className="tnum" value={port} onChange={(e) => setPort(e.target.value)} />
              </Field>
            )}
            <Button variant="primary" className="w-full" onClick={() => run()} disabled={!src}>
              トレースを実行
            </Button>
          </Card>

          {result && (
            <Card className="p-4">
              <div className={clsx("mb-4 flex items-center gap-2 font-medium", result.ok ? "text-ok" : "text-err")}>
                <span className={clsx("size-2 rounded-full", result.ok ? "bg-ok" : "bg-err")} />
                {result.summary}
              </div>
              <TraceView hops={result.hops} />
            </Card>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <Card className="overflow-hidden">
            <div className="h-[420px]">
              <TopologyView highlight={result} interactive={false} />
            </div>
            {result && result.segments.length > 0 && (
              <ol className="flex flex-wrap gap-x-1 gap-y-1.5 border-t border-line-soft px-4 py-3 text-[12px]">
                {result.segments.map((seg, i) => (
                  <li key={i} className="flex items-center gap-1">
                    {i > 0 && <span className="text-faint">→</span>}
                    <span className={clsx("rounded border px-1.5 py-px", seg.fail ? "border-err/50 text-err" : "border-line text-fg-2")}>
                      <span className="tnum text-muted">{i + 1}.</span> {nodeName(seg.to)} <span className="text-muted">({seg.label})</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
          {result && ran && (
            <Card title="パケットキャプチャ" action={<span className="text-[12px] text-muted">各区間のヘッダー · 黄色は前のフレームから変わった値</span>}>
              <div className="px-4 pb-4">
                <CaptureView frames={buildCapture(s, { ...ran, protocol, port: portNum }, result)} />
              </div>
            </Card>
          )}
          <Matrix protocol={protocol} port={portNum} onPick={(a, b) => (setSrc(a), setDst(b), run(a, b))} />
        </div>
      </div>
    </>
  );
}

function Matrix({ onPick, protocol, port }: { onPick: (a: string, b: string) => void; protocol: Protocol; port: number | null }) {
  const s = useScenario();
  const cols = useMemo(() => [...s.clients.map((c) => ({ id: c.id, name: c.name })), { id: "internet", name: "インターネット" }], [s.clients]);
  const grid = useMemo(
    () => s.clients.map((a) => cols.map((b) => (a.id === b.id ? null : trace(s, { srcId: a.id, dst: b.id, protocol, port }).ok))),
    [s, cols, protocol, port],
  );
  return (
    <Card title="到達性マトリクス" action={<span className="text-[12px] text-muted">行: 送信元 / 列: 宛先 · {protocol.toUpperCase()}{port ? `/${port}` : ""}</span>}>
      <div className="overflow-x-auto px-4 pb-4">
        <table className="text-[12px]">
          <thead>
            <tr>
              <th />
              {cols.map((c) => (
                <th key={c.id} className="h-24 px-0.5 align-bottom font-normal text-muted">
                  <div className="w-6 rotate-180 truncate whitespace-nowrap [writing-mode:vertical-rl]">{c.name}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.clients.map((a, i) => (
              <tr key={a.id}>
                <td className="pr-3 text-right whitespace-nowrap text-fg-2">{a.name}</td>
                {cols.map((b, j) => {
                  const v = grid[i][j];
                  return (
                    <td key={b.id} className="p-0.5">
                      {v === null ? (
                        <div className="size-6 rounded-sm bg-surface-2" />
                      ) : (
                        <button
                          onClick={() => onPick(a.id, b.id)}
                          className={clsx("block size-6 rounded-sm transition-opacity hover:opacity-70", v ? "bg-ok/70" : "bg-err/60")}
                          title={`${a.name} → ${b.name}: ${v ? "到達可能" : "到達不可"}`}
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 flex gap-4 text-[12px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-ok/70" /> 到達可能
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-err/60" /> 到達不可
          </span>
        </div>
      </div>
    </Card>
  );
}
