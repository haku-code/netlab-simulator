"use client";

import { useMemo, useState } from "react";
import { buildCapture, INTERNET_IP } from "@/lib/capture";
import { probe } from "@/lib/emu";
import type { Protocol, Scenario } from "@/lib/model";
import { assignLeases, carries, findGateway, l2Path, resolveClient, trace } from "@/lib/net/simulate";
import { useScenario } from "@/lib/store";
import { Field, Input, Segmented, Select } from "../ui";
import { CaptureView } from "./CaptureView";
import { SequenceDiagram, type SeqMessage } from "./SequenceDiagram";

function hash(str: string) {
  let h = 0;
  for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

function useClientOptions() {
  const s = useScenario();
  return s.clients.map((c) => ({ value: c.id, label: c.name }));
}

// --- レイヤーとカプセル化 ----------------------------------------------------------

export function OsiLab() {
  const rows = [
    ["7 アプリケーション", "アプリケーション", "HTTP, DNS, DHCP"],
    ["6 プレゼンテーション", "", "TLS, 文字コード"],
    ["5 セッション", "", ""],
    ["4 トランスポート", "トランスポート", "TCP, UDP（ポート番号）"],
    ["3 ネットワーク", "インターネット", "IP, ICMP（ルーター）"],
    ["2 データリンク", "ネットワークインターフェース", "Ethernet, 802.1Q VLAN, ARP（スイッチ）"],
    ["1 物理", "", "ケーブル, 無線"],
  ];
  return (
    <div className="space-y-5">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[12.5px]">
          <thead>
            <tr className="text-muted">
              <th className="border-b border-line py-1.5 pr-4 font-medium">OSI 参照モデル</th>
              <th className="border-b border-line py-1.5 pr-4 font-medium">TCP/IP</th>
              <th className="border-b border-line py-1.5 font-medium">例</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r[0]}>
                <td className="border-b border-line-soft py-1.5 pr-4">{r[0]}</td>
                <td className="border-b border-line-soft py-1.5 pr-4 text-fg-2">{r[1]}</td>
                <td className="border-b border-line-soft py-1.5 text-muted">{r[2]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <div className="mb-2 text-[12px] font-medium text-muted">カプセル化（送信時に外側へヘッダーが付く）</div>
        <div className="flex overflow-x-auto rounded border border-line font-mono text-[11.5px]">
          {[
            ["Ethernet ヘッダー", "宛先MAC / 送信元MAC", "#dbeafe"],
            ["802.1Q", "VLAN ID", "#ede9fe"],
            ["IP ヘッダー", "送信元IP / 宛先IP / TTL", "#dcfce7"],
            ["TCP ヘッダー", "ポート / Seq / フラグ", "#fef3c7"],
            ["データ", "HTTP など", "#f3f4f6"],
            ["FCS", "誤り検出", "#dbeafe"],
          ].map(([t, d, bg]) => (
            <div key={t} className="min-w-[110px] flex-1 border-r border-line px-2 py-2 text-[#1f2937] last:border-0" style={{ background: bg }}>
              <div className="font-sans font-semibold">{t}</div>
              <div className="text-[10.5px] opacity-70">{d}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- パケットキャプチャ ------------------------------------------------------------

export function CaptureLab() {
  const s = useScenario();
  const opts = useClientOptions();
  const [src, setSrc] = useState(s.clients[0]?.id ?? "");
  const [dst, setDst] = useState(s.clients[2]?.id ?? "internet");
  const [protocol, setProtocol] = useState<Protocol>("tcp");
  const [port, setPort] = useState("80");
  const q = { srcId: src, dst, protocol, port: protocol === "icmp" ? null : Number(port) || null };
  const valid = s.clients.some((c) => c.id === src) && (dst === "internet" || s.clients.some((c) => c.id === dst));
  const frames = useMemo(() => (valid ? buildCapture(s, q, trace(s, q)) : []), [s, src, dst, protocol, port]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-4">
        <Field label="送信元">
          <Select value={src} onChange={setSrc} options={opts} />
        </Field>
        <Field label="宛先">
          <Select value={dst} onChange={setDst} options={[{ value: "internet", label: `Internet (${INTERNET_IP})` }, ...opts.filter((o) => o.value !== src)]} />
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
            <Input className="tnum" value={port} onChange={(e) => setPort(e.target.value)} />
          </Field>
        )}
      </div>
      <CaptureView frames={frames} />
    </div>
  );
}

// --- ARP と MAC テーブル -----------------------------------------------------------

function portName(s: Scenario, linkId: string, devId: string) {
  const l = s.links.find((x) => x.id === linkId)!;
  const end = l.a.deviceId === devId ? l.a : l.b;
  return s.devices.find((d) => d.id === devId)?.ports.find((p) => p.id === end.portId)?.name ?? "?";
}

export function ArpLab() {
  const s = useScenario();
  const opts = useClientOptions();
  const [src, setSrc] = useState(s.clients[0]?.id ?? "");
  const [dst, setDst] = useState(s.clients[1]?.id ?? "");

  const model = useMemo(() => {
    const a = s.clients.some((c) => c.id === src) ? resolveClient(s, src) : null;
    const b = s.clients.some((c) => c.id === dst) ? resolveClient(s, dst) : null;
    if (!a || !b || a.error || !a.network) return { error: a?.error ?? "送信元を選んでください。" };
    const gw = findGateway(s)!;
    const sameNet = b.network?.id === a.network.id && !b.error;
    const targetName = sameNet ? b.client.name : `${gw.name} (${a.network.gatewayIp})`;
    const targetIp = sameNet ? b.ip! : a.network.gatewayIp;
    const targetMac = sameNet ? b.client.mac : gw.mac;
    const r = l2Path(s, a.network.id, a.attachDeviceId!, sameNet ? b.attachDeviceId! : gw.id);
    const vlan = a.network.vlanId;
    const devs = r.deviceIds;
    const ingressFromSrc = (i: number) =>
      i === 0 ? (a.client.connection.type === "wired" ? (s.devices.find((d) => d.id === devs[0])?.ports.find((p) => p.id === (a.client.connection as { portId: string }).portId)?.name ?? "?") : "Wi-Fi") : portName(s, r.linkIds[i - 1], devs[i]);
    const ingressFromDst = (i: number) =>
      i === devs.length - 1 ? (sameNet ? (b.client.connection.type === "wired" ? (s.devices.find((d) => d.id === devs[i])?.ports.find((p) => p.id === (b.client.connection as { portId: string }).portId)?.name ?? "?") : "Wi-Fi") : "(自分)") : portName(s, r.linkIds[i], devs[i]);
    const switches = devs.map((id, i) => ({ dev: s.devices.find((d) => d.id === id)!, i })).filter((x) => x.dev.type !== "gateway");
    const flood = (devId: string, ingress: string) =>
      s.devices
        .find((d) => d.id === devId)!
        .ports.filter((p) => p.enabled && p.name !== ingress && carries(p, a.network!.id))
        .map((p) => p.name);

    const participants = [a.client.name, ...switches.map((x) => x.dev.name), targetName];
    const msgs: SeqMessage[] = [];
    const chain = [a.client.name, ...switches.map((x) => x.dev.name)];
    chain.forEach((from, i) => {
      const to = i + 1 < chain.length ? chain[i + 1] : targetName;
      msgs.push({
        from,
        to,
        label: "ARP Request (Broadcast)",
        detail:
          i === 0
            ? `Who has ${targetIp}? → 宛先 ff:ff:ff:ff:ff:ff`
            : (() => {
                  const ports = flood(switches[i - 1].dev.id, ingressFromSrc(switches[i - 1].i));
                  return `VLAN ${vlan} の他の全ポートへフラッディング (${ports.slice(0, 3).join(", ")}${ports.length > 3 ? ` ほか ${ports.length - 3}` : ""})`;
                })(),
        dropped: !r.ok && i === chain.length - 1,
      });
    });
    if (r.ok) {
      const back = [targetName, ...switches.map((x) => x.dev.name).reverse(), a.client.name];
      back.slice(0, -1).forEach((from, i) =>
        msgs.push({ from, to: back[i + 1], label: "ARP Reply (Unicast)", detail: i === 0 ? `${targetIp} is at ${targetMac}` : "MAC テーブルに送信元の場所があるので 1 ポートだけへ転送", tone: "ok" }),
      );
    }
    const tables = switches.map((x) => ({
      name: x.dev.name,
      rows: [
        { mac: a.client.mac, port: ingressFromSrc(x.i), vlan, when: "Request の送信元から学習" },
        ...(r.ok ? [{ mac: targetMac, port: ingressFromDst(x.i), vlan, when: "Reply の送信元から学習" }] : []),
      ],
    }));
    return { participants, msgs, tables, sameNet, r, targetIp };
  }, [s, src, dst]);

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="送信元">
          <Select value={src} onChange={setSrc} options={opts} />
        </Field>
        <Field label="通信したい相手">
          <Select value={dst} onChange={setDst} options={opts.filter((o) => o.value !== src)} />
        </Field>
      </div>
      {"error" in model ? (
        <p className="text-err">{model.error}</p>
      ) : (
        <>
          <p className="text-[12.5px] text-fg-2">
            {model.sameNet ? `同じネットワークなので、相手 (${model.targetIp}) の MAC を直接調べます。` : `相手は別のネットワークなので、ゲートウェイ (${model.targetIp}) の MAC を調べます。`}
            {!model.r.ok && <span className="text-err"> {model.r.reason}</span>}
          </p>
          <SequenceDiagram participants={model.participants} messages={model.msgs} />
          <div className="grid gap-3 md:grid-cols-2">
            {model.tables.map((t) => (
              <div key={t.name} className="rounded border border-line">
                <div className="border-b border-line bg-surface-2 px-3 py-1.5 text-[12px] font-semibold">{t.name} の MAC アドレステーブル</div>
                <table className="tnum w-full font-mono text-[11.5px]">
                  <tbody>
                    {t.rows.map((r) => (
                      <tr key={r.mac} className="border-b border-line-soft last:border-0">
                        <td className="px-3 py-1.5">{r.mac}</td>
                        <td className="px-2 py-1.5 font-sans">{r.port}</td>
                        <td className="px-2 py-1.5">VLAN {r.vlan}</td>
                        <td className="px-2 py-1.5 font-sans text-[11px] text-muted">{r.when}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// --- DHCP ---------------------------------------------------------------------

export function DhcpLab() {
  const s = useScenario();
  const opts = useClientOptions();
  const [id, setId] = useState(s.clients[0]?.id ?? "");

  const msgs = useMemo<SeqMessage[] | string>(() => {
    const c = s.clients.find((x) => x.id === id);
    if (!c) return "端末を選んでください。";
    if (c.ipMode === "static") return `${c.name} は固定 IP (${c.staticIp}) なので DHCP を使いません。`;
    const st = resolveClient(s, id);
    const C = c.name;
    const S = "DHCP サーバー (Gateway)";
    if (st.errorStage === "attach") return [{ from: C, to: C, self: true, label: "リンクがないので送信できません", detail: st.error, tone: "err" }];
    const out: SeqMessage[] = [];
    // 古いリース: まず以前の IP を要求 → NAK
    if (st.staleLease && c.lease) {
      out.push({ from: C, to: S, label: "DHCPREQUEST (以前の IP)", detail: `requested ${c.lease.ip}` });
      out.push({ from: S, to: C, label: "DHCPNAK", detail: `${c.lease.ip} はこのネットワーク (${st.network?.cidr}) では使えない`, tone: "err" });
    }
    // 新規取得をシミュレーション（リースを外した状態で計算）
    const sim = structuredClone(s);
    sim.clients.find((x) => x.id === id)!.lease = null;
    const fresh = resolveClient(assignLeases(sim), id);
    const net = fresh.network ?? st.network;
    const discover: SeqMessage = { from: C, to: S, label: "DHCPDISCOVER", detail: `0.0.0.0:68 → 255.255.255.255:67 (Broadcast) / ${c.mac}` };
    if (!st.toGateway?.ok) {
      return [...out, { ...discover, dropped: true, detail: `${discover.detail} — ${st.toGateway && !st.toGateway.ok ? st.toGateway.reason : ""}` }, { from: C, to: C, self: true, label: "応答なし → 169.254.x.x を自己割り当て", tone: "err" }];
    }
    if (!net?.dhcp.enabled) {
      return [...out, discover, { from: S, to: S, self: true, label: "DHCP サーバーが無効なので応答しない", tone: "err" }, { from: C, to: C, self: true, label: "応答なし → 169.254.x.x を自己割り当て", tone: "err" }];
    }
    if (!fresh.ip || fresh.error) {
      return [...out, discover, { from: S, to: S, self: true, label: "割り当てられる空きアドレスがない", detail: fresh.error, tone: "err" }];
    }
    const ip = st.staleLease ? fresh.ip : (st.ip ?? fresh.ip);
    const opt = `Mask ${net.cidr.split("/")[1] ? `/${net.cidr.split("/")[1]}` : ""} · Router ${net.gatewayIp} · DNS ${net.gatewayIp} · Lease 86400s`;
    return [
      ...out,
      discover,
      { from: S, to: C, label: "DHCPOFFER", detail: `${net.gatewayIp} → ${ip} (yiaddr) · ${opt}` },
      { from: C, to: S, label: "DHCPREQUEST", detail: `0.0.0.0 → 255.255.255.255 / requested ${ip}` },
      { from: S, to: C, label: "DHCPACK", detail: `${ip} を確定 · ${opt}`, tone: "ok" },
    ];
  }, [s, id]);

  const c = s.clients.find((x) => x.id === id);
  return (
    <div className="space-y-3">
      <div className="max-w-xs">
        <Field label="端末">
          <Select value={id} onChange={setId} options={opts} />
        </Field>
      </div>
      {typeof msgs === "string" ? <p className="text-muted">{msgs}</p> : <SequenceDiagram participants={[c?.name ?? "端末", "DHCP サーバー (Gateway)"]} messages={msgs} />}
      <p className="text-[12px] text-muted">ネットワーク設定や VLAN を変えてからこのページに戻ると、やりとりがどう変わるか確認できます（例: DHCP を無効にする、ポートの VLAN を変える）。</p>
    </div>
  );
}

// --- TCP ----------------------------------------------------------------------

export function TcpLab() {
  const s = useScenario();
  const opts = useClientOptions();
  const [src, setSrc] = useState(s.clients[0]?.id ?? "");
  const [dst, setDst] = useState(s.clients[1]?.id ?? "");
  const [port, setPort] = useState("445");

  const view = useMemo(() => {
    const a = s.clients.find((c) => c.id === src);
    const internet = dst === "internet";
    const b = internet ? null : s.clients.find((c) => c.id === dst);
    if (!a || (!internet && !b)) return null;
    const p = Number(port) || 80;
    const host = internet ? "example.com" : (resolveClient(s, dst).ip ?? "0.0.0.0");
    const r = probe(s, src, host, "tcp", p);
    const A = a.name;
    const B = internet ? "example.com" : b!.name;
    const srcSt = resolveClient(s, src);
    const routed = internet || resolveClient(s, dst).network?.id !== srcSt.network?.id;
    const G = "Gateway (FW)";
    const participants = routed ? [A, G, B] : [A, B];
    const x = hash(src + dst) % 9000;
    const y = hash(dst + src) % 9000;
    const sport = 49152 + (hash(src + port) % 16000);
    const hdr = `${sport} → ${p}`;
    if (r.status === "noip" || r.status === "dns") return { participants: [A], msgs: [{ from: A, to: A, self: true, label: "送信できません", detail: r.message, tone: "err" as const }] };
    if (r.status === "timeout") {
      const dropAt = routed ? G : B;
      return {
        participants,
        msgs: [
          { from: A, to: dropAt, label: `SYN  Seq=${x}`, detail: `${hdr} — ${r.summary}`, dropped: true },
          { from: A, to: A, self: true, label: "1 秒待っても応答なし → 再送", tone: "muted" as const },
          { from: A, to: dropAt, label: `SYN  Seq=${x} (再送)`, dropped: true },
          { from: A, to: A, self: true, label: "2 秒 → 4 秒… と間隔を倍にして再送", tone: "muted" as const },
          { from: A, to: A, self: true, label: "タイムアウト (ERR_CONNECTION_TIMED_OUT)", tone: "err" as const },
        ],
      };
    }
    if (r.status === "refused") {
      return {
        participants,
        msgs: [
          { from: A, to: B, label: `SYN  Seq=${x}`, detail: hdr },
          { from: B, to: A, label: `RST, ACK  Ack=${x + 1}`, detail: `ポート ${p} で待ち受けているサービスがない`, tone: "err" as const },
          { from: A, to: A, self: true, label: "すぐに失敗 (ERR_CONNECTION_REFUSED)", tone: "err" as const },
        ],
      };
    }
    return {
      participants,
      msgs: [
        { from: A, to: B, label: `SYN  Seq=${x}`, detail: hdr },
        { from: B, to: A, label: `SYN, ACK  Seq=${y} Ack=${x + 1}`, detail: `${p} → ${sport}` },
        { from: A, to: B, label: `ACK  Seq=${x + 1} Ack=${y + 1}`, detail: "接続確立 (ESTABLISHED)", tone: "ok" as const },
        { from: A, to: B, label: `データ (例: HTTP GET)  Len=120`, detail: `Seq=${x + 1}` },
        { from: B, to: A, label: `ACK + 応答データ`, detail: `Ack=${x + 121}` },
        { from: A, to: B, label: "FIN, ACK", detail: "切断" },
        { from: B, to: A, label: "FIN, ACK" },
        { from: A, to: B, label: "ACK", tone: "ok" as const },
      ],
    };
  }, [s, src, dst, port]);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="クライアント">
          <Select value={src} onChange={setSrc} options={opts} />
        </Field>
        <Field label="サーバー">
          <Select value={dst} onChange={setDst} options={[{ value: "internet", label: "example.com (Internet)" }, ...opts.filter((o) => o.value !== src)]} />
        </Field>
        <Field label="宛先ポート" hint="例: 80 (HTTP) / 445 (SMB) / 631 (IPP) / 22 (SSH)">
          <Input className="tnum" value={port} onChange={(e) => setPort(e.target.value)} />
        </Field>
      </div>
      {view && <SequenceDiagram participants={view.participants} messages={view.msgs} />}
    </div>
  );
}

// --- DNS ----------------------------------------------------------------------

export function DnsLab() {
  const s = useScenario();
  const opts = useClientOptions();
  const [id, setId] = useState(s.clients[0]?.id ?? "");
  const [domain, setDomain] = useState("www.example.com");
  const [cached, setCached] = useState<"first" | "cached">("first");

  const view = useMemo(() => {
    const c = s.clients.find((x) => x.id === id);
    if (!c) return null;
    const st = resolveClient(s, id);
    const labels = domain.trim().toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
    if (labels.length < 2) return { error: "ドメイン名を入力してください（例: www.example.com）" };
    const tld = labels.at(-1)!;
    const zone = labels.slice(-2).join(".");
    const C = c.name;
    const G = "Gateway (フォワーダー)";
    const R = "ISP リゾルバー";
    const ROOT = "ルート (.)";
    const T = `TLD (.${tld})`;
    const AUTH = `権威 (${zone})`;
    const ip = `${93 + (hash(domain) % 100)}.${hash(domain + "a") % 256}.${hash(domain + "b") % 256}.${1 + (hash(domain + "c") % 254)}`;
    if (st.error || !st.toGateway?.ok) return { participants: [C, G], msgs: [{ from: C, to: G, label: `A ${domain}?`, dropped: true, detail: st.error ?? (st.toGateway && !st.toGateway.ok ? st.toGateway.reason : undefined) }] as SeqMessage[] };
    const gwIp = st.network!.gatewayIp;
    if (cached === "cached")
      return {
        participants: [C, G],
        msgs: [
          { from: C, to: G, label: `A ${domain}? (再帰)`, detail: `${st.ip}:${50000 + (hash(id) % 9999)} → ${gwIp}:53 / UDP` },
          { from: G, to: G, self: true, label: "キャッシュにあり (TTL 残り 3540 秒)", tone: "ok" as const },
          { from: G, to: C, label: `A ${ip}`, detail: "数ミリ秒で応答", tone: "ok" as const },
        ] as SeqMessage[],
      };
    return {
      participants: [C, G, R, ROOT, T, AUTH],
      msgs: [
        { from: C, to: G, label: `A ${domain}? (再帰)`, detail: `→ ${gwIp}:53/UDP` },
        { from: G, to: R, label: "そのまま転送 (再帰)" },
        { from: R, to: ROOT, label: `A ${domain}? (反復)` },
        { from: ROOT, to: R, label: `参照: .${tld} は TLD サーバーへ`, tone: "muted" as const },
        { from: R, to: T, label: `A ${domain}?` },
        { from: T, to: R, label: `参照: ${zone} は ns1.${zone} へ`, tone: "muted" as const },
        { from: R, to: AUTH, label: `A ${domain}?` },
        { from: AUTH, to: R, label: `A ${ip} (TTL 3600)`, tone: "ok" as const },
        { from: R, to: G, label: `A ${ip}`, detail: "キャッシュに保存" },
        { from: G, to: C, label: `A ${ip}`, detail: "キャッシュに保存", tone: "ok" as const },
      ] as SeqMessage[],
    };
  }, [s, id, domain, cached]);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="端末">
          <Select value={id} onChange={setId} options={opts} />
        </Field>
        <Field label="ドメイン名">
          <Input value={domain} onChange={(e) => setDomain(e.target.value)} />
        </Field>
        <Field label="問い合わせ">
          <Segmented
            value={cached}
            onChange={setCached}
            options={[
              { value: "first", label: "1 回目" },
              { value: "cached", label: "2 回目 (キャッシュ)" },
            ]}
          />
        </Field>
      </div>
      {view && ("error" in view ? <p className="text-err">{view.error}</p> : <SequenceDiagram participants={view.participants} messages={view.msgs} />)}
    </div>
  );
}

