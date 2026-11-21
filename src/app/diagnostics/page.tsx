"use client";

import clsx from "clsx";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { logTraceBlock } from "@/lib/ops/store";
import { TopologyView } from "@/components/topology/TopologyView";
import { TraceView } from "@/components/TraceView";
import { Button, Card, Field, Input, PageHeader, Segmented, Select } from "@/components/ui";
import type { Protocol } from "@/lib/model";
import { buildCapture, nodeName } from "@/lib/capture";
import { trace, type TraceQuery } from "@/lib/net/simulate";
import { WAN_IDS, WAN_IPS, WAN_NAMES } from "@/lib/net/gateway";
import { parseIp } from "@/lib/net/ip";
import { parseIpv6, type IpFamily } from "@/lib/net/ipv6";
import { useSecurityLog } from "@/lib/security-log";
import { CaptureView } from "@/components/theory/CaptureView";
import { useScenario } from "@/lib/store";
import { probe } from "@/lib/emu";
import { webError } from "@/lib/web";
import { WebCapture } from "@/components/emulators/WebLab";
import { useClientStates } from "@/lib/hooks";
import { ClockControl } from "@/components/ClockControl";

export default function DiagnosticsPage() {
  const s = useScenario();
  const states = useClientStates();
  const [selectedSrc, setSrc] = useState("");
  const [selectedDst, setDst] = useState("internet");
  const [protocol, setProtocol] = useState<Protocol>("icmp");
  const [port, setPort] = useState("443");
  const [destinationIp, setDestinationIp] = useState("");
  const [family, setFamily] = useState<IpFamily>("ipv4");
  const [ran, setRan] = useState<Pick<TraceQuery, "srcId" | "dst" | "dstIp" | "family"> | null>(null);
  const parsedPort = Number(port);
  const validPort = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535 ? parsedPort : null;
  const portNum = protocol === "icmp" ? null : validPort;

  const clientOpts = s.clients.map((c) => ({ value: c.id, label: c.name }));
  const src = selectedSrc === "internet" ? selectedSrc : s.clients.find((c) => c.id === selectedSrc)?.id ?? s.clients[0]?.id ?? "internet";
  const inbound = src === "internet";
  const dstOpts = inbound
    ? WAN_IDS.map((id) => ({ value: id, label: `${WAN_NAMES[id]} · ${WAN_IPS[id]}` }))
    : [{ value: "internet", label: "インターネット" }, { value: "ip", label: "IP アドレスを指定" }, ...clientOpts.filter((o) => o.value !== src)];
  const dst = dstOpts.some((o) => o.value === selectedDst) ? selectedDst : inbound ? "wan1" : "internet";
  const activeProtocol = inbound && protocol === "icmp" ? "tcp" : protocol;
  const invalidIp = dst === "ip" && (family === "ipv6" ? parseIpv6(destinationIp) : parseIp(destinationIp)) === null;
  const run = () => {
    const selection = { srcId: src, dst: dst === "ip" ? "internet" : dst, dstIp: dst === "ip" ? destinationIp.trim() : undefined, family: inbound ? "ipv4" as const : family };
    const outcome = trace(s, { ...selection, protocol: activeProtocol, port: activeProtocol === "icmp" ? null : validPort }, states);
    useSecurityLog.getState().record(s.clients.find((client) => client.id === src)?.name ?? src, outcome.security);
    setRan(selection);
  };
  const changeSource = (id: string) => {
    if (id === dst) setDst("internet");
    if (id === "internet" && protocol === "icmp") setProtocol("tcp");
    setSrc(id);
  };
  const pickPair = useCallback((srcId: string, destination: string) => {
    setSrc(srcId);
    setDst(destination);
    setRan({ srcId, dst: destination });
  }, []);

  // 設定が変わったら結果を再計算する
  const query = useMemo<TraceQuery | null>(() => {
    if (!ran) return null;
    if (ran.srcId === "internet") return { ...ran, protocol: protocol === "icmp" ? "tcp" : protocol, port: validPort };
    if (!s.clients.some((c) => c.id === ran.srcId) || (ran.dst !== "internet" && !s.clients.some((c) => c.id === ran.dst))) return null;
    return { ...ran, protocol, port: portNum };
  }, [s.clients, ran, protocol, portNum, validPort]);
  const result = useMemo(() => query ? trace(s, query, states) : null, [s, query, states]);
  // ファイアウォールで止まった通信はシステムログに記録する
  useEffect(() => {
    if (query && result) logTraceBlock(s, query, result);
  }, [s, query, result]);
  const webService = ran?.srcId !== "internet" && protocol === "tcp" && (portNum === 80 || portNum === 443)
    ? s.clients.find((c) => c.id === ran?.dst && c.kind === "server")?.webService
    : undefined;

  return (
    <>
      <PageHeader title="パケットトレース"><ClockControl /></PageHeader>
      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card className="space-y-3 p-4">
            <Field label="送信元">
              <Select aria-label="トレースの送信元" value={src} onChange={changeSource} options={[...clientOpts, { value: "internet", label: "外部テスト端末（WAN から着信）" }]} />
            </Field>
            <Field label="宛先">
              <Select aria-label="トレースの宛先" value={dst} onChange={setDst} options={dstOpts} />
            </Field>
            {!inbound && <Field label="IP バージョン">
              <Select aria-label="トレースの IP バージョン" value={family} onChange={(v) => setFamily(v as IpFamily)}
                options={[{ value: "ipv4", label: "IPv4" }, { value: "ipv6", label: "IPv6" }]} />
            </Field>}
            {dst === "ip" && <Field label="宛先 IP アドレス">
              <Input aria-label="宛先 IP アドレス" value={destinationIp} placeholder={family === "ipv6" ? "2001:db8:ffff::10" : "10.20.0.10"} onChange={(e) => setDestinationIp(e.target.value)} />
            </Field>}
            <Field label="プロトコル">
              <Segmented<Protocol>
                value={activeProtocol}
                onChange={setProtocol}
                options={[
                  ...(!inbound ? [{ value: "icmp" as const, label: "ICMP" }] : []),
                  { value: "tcp", label: "TCP" },
                  { value: "udp", label: "UDP" },
                ]}
              />
            </Field>
            {activeProtocol !== "icmp" && (
              <Field label="宛先ポート" hint={inbound ? "ポートフォワードの公開ポートを指定します。" : undefined}>
                <Input aria-label="トレースの宛先ポート" type="number" min={1} max={65535} className="tnum" value={port} onChange={(e) => setPort(e.target.value)} />
              </Field>
            )}
            <Button variant="primary" className="w-full" onClick={run} disabled={invalidIp || (inbound && validPort === null)}>
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
                    <span className="tnum text-muted">{i + 1}.</span> {nodeName(s, seg.to)} <span className="text-muted">({seg.label})</span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
          {result && query && result.segments.length > 0 && (
            <Card title="パケットキャプチャ" action={<span className="text-[12px] text-muted">各区間のヘッダー · 黄色は前のフレームから変わった値</span>}>
              <div className="px-4 pb-4">
                <CaptureView frames={buildCapture(s, query, result)} wirelessTools />
              </div>
            </Card>
          )}
          {result && ran && webService && (portNum === 80 || portNum === 443) && (
            <Card title="HTTP / TLS の通信">
              <div className="px-4 pb-4">
                <WebCapture
                  scenario={s}
                  clientId={ran.srcId}
                  transport={{ scheme: portNum === 443 ? "https" : "http", port: portNum }}
                  result={probe(s, ran.srcId, webService.host, "tcp", portNum, ran.family)}
                  family={ran.family}
                  problem={webError(webService, webService.host, portNum === 443 ? "https" : "http", portNum)}
                  event={{ method: "GET", path: "/", status: "200 OK" }}
                />
              </div>
            </Card>
          )}
          <Matrix protocol={protocol} port={portNum} onPick={pickPair} />
        </div>
      </div>
    </>
  );
}

const Matrix = memo(function Matrix({ onPick, protocol, port }: { onPick: (a: string, b: string) => void; protocol: Protocol; port: number | null }) {
  const s = useScenario();
  const states = useClientStates();
  const cols = useMemo(() => [...s.clients.map((c) => ({ id: c.id, name: c.name })), { id: "internet", name: "インターネット" }], [s.clients]);
  const grid = useMemo(
    () => s.clients.map((a) => cols.map((b) => (a.id === b.id ? null : trace(s, { srcId: a.id, dst: b.id, protocol, port }, states).ok))),
    [s, cols, protocol, port, states],
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
});
