"use client";

import clsx from "clsx";
import { ArrowRight, Cable, Check, ChevronRight, Lock, RotateCw, Wifi, WifiHigh, WifiLow, WifiOff, WifiZero } from "lucide-react";
import { useMemo, useState } from "react";
import { netInfo, parseUrl, pingLines, probe, tracerouteLines, type ProbeResult } from "@/lib/emu";
import { discover } from "@/lib/mdns";
import { useRouter } from "next/navigation";
import { CONNECT_DBM, VISIBLE_DBM } from "@/lib/floor";
import { associate, broadcasts, clientBands, isPositional, radioLink, resolveClient, wifiLink } from "@/lib/net/simulate";
import { useStore } from "@/lib/store";
import { usePcCapture } from "@/lib/pc-capture";
import { browserPackets, pingPackets } from "@/lib/pc-packets";
import { savedWifiPassword } from "@/lib/wifi";
import { wifiMode } from "@/lib/wifi-security";
import { TraceView } from "../TraceView";
import { SitePage } from "./sites";
import { WebCapture, WebLabSite } from "./WebLab";
import { webError, type WebEvent } from "@/lib/web";

export function useEmu(clientId: string) {
  const s = useStore((x) => x.scenario);
  const client = s.clients.find((c) => c.id === clientId)!;
  const info = useMemo(() => netInfo(s, clientId), [s, clientId]);
  return { s, client, info };
}

/** 端末のステータスバー等で使う接続アイコン */
export function LinkIcon({ clientId, size = 14, className }: { clientId: string; size?: number; className?: string }) {
  const { client, info } = useEmu(clientId);
  if (client.connection.type === "wired") {
    return <Cable size={size} className={clsx(className, !info.connected && "opacity-60")} />;
  }
  if (!info.wifi) {
    return <WifiOff size={size} role="img" aria-label="Wi-Fi 未接続" className={clsx(className, "opacity-60")} />;
  }
  const level = signalLevel(info.wifi.rssi);
  const Icon = WIFI_LEVELS[level - 1];
  const label = `Wi-Fi 電波 ${level}/4（${info.wifi.rssi} dBm）`;
  return (
    <span role="img" aria-label={label} title={label} className={clsx("relative inline-flex", className)}>
      {level < 4 && <Wifi size={size} className="absolute inset-0 opacity-20" />}
      <Icon size={size} />
    </span>
  );
}

const WIFI_LEVELS = [WifiZero, WifiLow, WifiHigh, Wifi];
export const signalLevel = (rssi: number) => rssi > -55 ? 4 : rssi > -63 ? 3 : rssi > -70 ? 2 : 1;

export function SignalBars({ rssi }: { rssi: number }) {
  const n = signalLevel(rssi);
  return (
    <span className="flex h-3 items-end gap-[2px]" title={`${rssi} dBm`}>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className={clsx("w-[3px] rounded-[1px]", i <= n ? "bg-current opacity-80" : "bg-current opacity-20")} style={{ height: `${i * 25}%` }} />
      ))}
    </span>
  );
}

/** 学習用: 端末からは見えない本当の原因 */
export function WhyBox({ text }: { text?: string }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <div className="rounded border border-dashed border-warn/60 bg-warn/5 px-3 py-2 text-[12px]">
      <button onClick={() => setOpen(!open)} className="font-medium text-warn">
        {open ? "▾" : "▸"} 学習用: 原因を見る
      </button>
      {open && <p className="mt-1 leading-relaxed whitespace-pre-line text-fg-2">{text}</p>}
    </div>
  );
}

// --- ネットワーク設定 ------------------------------------------------------------

export function NetworkSettings({ clientId, dark }: { clientId: string; dark?: boolean }) {
  const { client, info } = useEmu(clientId);
  const mutate = useStore((x) => x.mutate);
  const renew = useStore((x) => x.renewLease);
  const [manualIp, setManualIp] = useState(client.staticIp);
  const st = info.st;
  const linkDown = st.errorStage === "attach";
  const noDhcp = client.ipMode === "dhcp" && !st.ip && !linkDown;

  const status = linkDown
    ? { tone: "text-err", text: client.connection.type === "wired" ? "ケーブルが接続されていないか、リンクがありません" : "Wi-Fi に接続されていません" }
    : noDhcp
      ? { tone: "text-warn", text: "IP アドレスを取得できませんでした（自己割り当て IP）" }
      : st.error
        ? { tone: "text-warn", text: "接続済み・通信できません" }
        : { tone: "text-ok", text: "接続済み" };

  const row = "flex justify-between gap-4 py-1.5";
  const label = dark ? "text-white/50" : "text-muted";
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <LinkIcon clientId={clientId} size={16} />
        <div>
          <div className="font-medium">{info.linkLabel}</div>
          {info.radio && <div className="tnum text-[11.5px] opacity-60">{info.radio}</div>}
          <div className={clsx("text-[12px]", status.tone)}>{status.text}</div>
        </div>
      </div>
      <div className={clsx("tnum divide-y text-[12.5px]", dark ? "divide-white/10" : "divide-line-soft")}>
        <div className={row}>
          <span className={label}>IP アドレス</span>
          <span>{noDhcp ? `169.254.${(client.mac.charCodeAt(16) * 7) % 254}.${client.mac.charCodeAt(15) % 254}` : (info.ip ?? "—")}</span>
        </div>
        <div className={row}>
          <span className={label}>サブネットマスク</span>
          <span>{noDhcp ? "255.255.0.0" : (info.mask ?? "—")}</span>
        </div>
        <div className={row}>
          <span className={label}>ルーター</span>
          <span>{info.router ?? "—"}</span>
        </div>
        <div className={row}>
          <span className={label}>DNS</span>
          <span>{info.dns ?? "—"}</span>
        </div>
        <div className={row}>
          <span className={label}>MAC アドレス</span>
          <span>{client.mac}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={client.ipMode}
          onChange={(e) =>
            mutate((s) => {
              const c = s.clients.find((x) => x.id === clientId)!;
              c.ipMode = e.target.value as "dhcp" | "static";
              c.lease = null;
            })
          }
          className={clsx("h-7 rounded border px-2 text-[12.5px]", dark ? "border-white/20 bg-white/10" : "border-line bg-surface")}
        >
          <option value="dhcp">DHCP を使用</option>
          <option value="static">手動で設定</option>
        </select>
        {client.ipMode === "dhcp" ? (
          <button
            onClick={() => renew(clientId)}
            className={clsx("inline-flex h-7 items-center gap-1.5 rounded border px-2.5 text-[12.5px]", dark ? "border-white/20 hover:bg-white/10" : "border-line hover:bg-hover")}
          >
            <RotateCw size={12} /> DHCP リースを更新
          </button>
        ) : (
          <>
            <input
              value={manualIp}
              onChange={(e) => setManualIp(e.target.value)}
              placeholder="192.168.1.50"
              className={clsx("tnum h-7 w-36 rounded border px-2 text-[12.5px] outline-none", dark ? "border-white/20 bg-white/10" : "border-line bg-surface focus:border-accent")}
            />
            <button
              onClick={() => mutate((s) => (s.clients.find((x) => x.id === clientId)!.staticIp = manualIp.trim()))}
              className="h-7 rounded bg-accent px-2.5 text-[12.5px] text-white"
            >
              適用
            </button>
          </>
        )}
      </div>
      <WhyBox text={st.error} />
    </div>
  );
}

// --- Wi-Fi 一覧 ---------------------------------------------------------------

export function WifiList({ clientId, dark }: { clientId: string; dark?: boolean }) {
  const { s, client, info } = useEmu(clientId);
  const join = useStore((x) => x.joinWifi);
  const disconnect = useStore((x) => x.disconnectWifi);
  const [pending, setPending] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [identity, setIdentity] = useState("");
  const current = client.connection.type === "wifi" ? client.connection.ssidId : null;
  const hasAp = s.devices.some((d) => d.type === "ap");
  const connectionError = current && info.st.errorStage === "attach" ? info.st.error : undefined;

  const router = useRouter();
  const positional = isPositional(s, client);
  const apId = client.connection.type === "wifi" ? client.connection.apId : s.devices.find((d) => d.type === "ap")?.id;
  // フロアプランあり: その場所で電波が届く SSID だけが見える（最も強い AP の値）
  // なし: 近くの AP が配信していて、対応している周波数帯の SSID だけが見える
  const onAir = positional ? s.ssids : apId ? s.ssids.filter((w) => broadcasts(w, apId)) : [];
  const visible = onAir.flatMap((w) => {
    if (positional) {
      const as = associate(s, client, w);
      const best = as.ok ? as : as.best;
      if (!best || best.rssi < VISIBLE_DBM) return [];
      const link = radioLink(s, client, w, best.ap.id);
      return link ? [{ w, link, weak: best.rssi < CONNECT_DBM }] : [];
    }
    const link = apId ? wifiLink(client, w, apId) : null;
    return link ? [{ w, link, weak: false }] : [];
  });
  const hidden = positional ? 0 : onAir.length - visible.length;
  const apName = positional ? (info.st.attachDeviceId ? s.devices.find((d) => d.id === info.st.attachDeviceId)?.name : undefined) : s.devices.find((d) => d.id === apId)?.name;

  if (!hasAp) return <p className="text-[12.5px] opacity-60">利用できる Wi-Fi ネットワークがありません</p>;
  return (
    <div className="space-y-2">
      <ul className={clsx("divide-y overflow-hidden rounded", dark ? "divide-white/10 bg-white/5" : "divide-line-soft border border-line")}>
        {visible.map(({ w, link, weak }) => {
          const selected = current === w.id;
          const password = savedWifiPassword(client, w.id);
          const { auth, radio } = wifiMode(w.security);
          const savedIdentity = client.wifiIdentities?.[w.id];
          const hasCredentials = password !== undefined && (auth === "shared" || (auth === "enterprise" && !!savedIdentity));
          const retry = selected && info.st.wifiAuthFailed && (auth === "shared" || auth === "enterprise");
          return (
            <li key={w.id}>
              <button
                onClick={() => {
                  setPw("");
                  setIdentity("");
                  if (selected) {
                    setPending(null);
                    return;
                  }
                  if (auth === "none" || auth === "certificate" || hasCredentials) {
                    setPending(null);
                    join(clientId, w.id, hasCredentials ? password ?? "" : "", auth === "enterprise" ? savedIdentity : undefined);
                  } else setPending(w.id);
                }}
                className={clsx("flex w-full items-center gap-2.5 px-3 py-2 text-left", dark ? "hover:bg-white/10" : "hover:bg-hover")}
              >
                <span className="w-4">{selected && info.wifi && <Check size={14} className="text-accent" />}</span>
                <span className="flex-1 truncate">
                  {w.name}
                  {!selected && hasCredentials && <span className="ml-1.5 text-[10.5px] opacity-60"> 保存済み</span>}
                  {weak && <span className="ml-1.5 text-[10.5px] text-warn">電波が弱い</span>}
                </span>
                {radio === "legacy" && <span className="text-[10.5px] text-warn">旧方式</span>}
                {radio !== "open" && <Lock size={12} className="opacity-50" />}
                <span className="tnum text-[10.5px] opacity-50">{link.band}G</span>
                <SignalBars rssi={link.rssi} />
              </button>
              {(pending === w.id || (!pending && retry)) && (
                <form
                  className="grid gap-2 px-3 pb-2.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    join(clientId, w.id, pw, auth === "enterprise" ? identity.trim() : undefined);
                    setPw("");
                    setIdentity("");
                    setPending(null);
                  }}
                >
                  {auth === "enterprise" && (
                    <input aria-label="802.1X ユーザー名" placeholder="802.1X ユーザー名" value={identity} onChange={(e) => setIdentity(e.target.value)} required className="h-7 rounded border border-line px-2" />
                  )}
                  <input
                    autoFocus
                    type="password"
                    autoComplete="off"
                    aria-label={`${w.name} のパスワード`}
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    placeholder="パスワード"
                    className={clsx("h-7 min-w-0 flex-1 rounded border px-2 text-[12.5px] outline-none", dark ? "border-white/20 bg-white/10" : "border-line bg-surface focus:border-accent")}
                  />
                  <button className="h-7 rounded bg-accent px-3 text-[12.5px] text-white">接続</button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
      {connectionError && <p className="text-[12px] text-err">{connectionError}</p>}
      {hidden > 0 && (
        <p className="text-[11.5px] opacity-60">
          この端末は {clientBands(client).join(" / ")} GHz のみ対応のため、表示されていない SSID が {hidden} 件あります。
        </p>
      )}
      {current && (
        <button onClick={() => disconnect(clientId)} className="text-[12px] text-accent hover:underline">
          このネットワークから切断
        </button>
      )}
      <p className="text-[11.5px] opacity-60">
        {positional ? `接続中の AP: ${apName ?? "なし"}（場所はフロアプランで移動できます）。` : `近くの AP: ${apName ?? "なし"}。`}
        <button onClick={() => router.push(current ? `/settings/wifi?id=${current}` : "/settings/wifi")} className="ml-1 text-accent underline">
          Wi-Fi 設定（パスワード）を開く
        </button>
      </p>
    </div>
  );
}

// --- ブラウザ -----------------------------------------------------------------

export function Browser({ clientId, home = "", compact }: { clientId: string; home?: string; compact?: boolean }) {
  const s = useStore((x) => x.scenario);
  const [input, setInput] = useState(home);
  const [url, setUrl] = useState<string | null>(home || null);
  const [tick, setTick] = useState(0);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [traffic, setTraffic] = useState<WebEvent>({ method: "GET", path: "/", status: "200 OK" });
  const parsed = url ? parseUrl(url) : null;
  const recordTraffic = (address: string, event: WebEvent, newConnection: boolean) => {
    setTraffic(event);
    usePcCapture.getState().record(clientId, () => browserPackets(s, clientId, address, event, newConnection));
  };
  const navigate = (address: string) => {
    setInput(address);
    setUrl(address);
    recordTraffic(address, { method: "GET", path: "/", status: "200 OK" }, true);
    setTick((t) => t + 1);
  };
  // 設定が変わると結果も変わる（再読み込みしなくても反映）
  const result = useMemo<ProbeResult | null>(
    () => (parsed ? probe(s, clientId, parsed.host, "tcp", parsed.port) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s, clientId, url, tick],
  );

  const server = result && "target" in result && result.target.kind === "client" && result.target.client.kind === "server"
    && result.target.client.webService ? result.target.client : null;
  const problem = server?.webService && parsed && result?.status === "ok"
    ? webError(server.webService, parsed.host, parsed.scheme, parsed.port)
    : null;
  const labServers = s.clients.filter((c) => c.kind === "server" && c.webService);

  return (
    <div className="flex h-full flex-col bg-white text-[#222]">
      <form
        className={clsx("flex items-center gap-1.5 border-b border-black/10 bg-[#f3f4f6]", compact ? "p-1.5" : "p-2")}
        onSubmit={(e) => {
          e.preventDefault();
          navigate(input);
        }}
      >
        <button type="button" onClick={() => url && navigate(url)} className="rounded p-1 text-black/50 hover:bg-black/5" aria-label="再読み込み">
          <RotateCw size={13} />
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="URL を入力 (例: 192.168.1.20 や example.com)"
          className="h-7 min-w-0 flex-1 rounded-full border border-black/10 bg-white px-3 text-[12.5px] outline-none focus:border-[#006fff]"
        />
        <button className="rounded p-1 text-black/50 hover:bg-black/5" aria-label="移動">
          <ArrowRight size={14} />
        </button>
      </form>
      {parsed && result && (
        <div className="flex flex-wrap items-center justify-between gap-1 border-b border-black/10 px-2.5 py-1 text-[11px]">
          <span>{parsed.scheme === "https" ? (result.status === "ok" && !problem ? "HTTPS · TLS" : "HTTPS") : "HTTP · 平文"}</span>
          <button type="button" aria-expanded={captureOpen} onClick={() => setCaptureOpen(!captureOpen)} className="font-medium text-[#075aaa] underline">通信キャプチャ</button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {captureOpen && parsed && result && (
          <div className="border-b border-black/10 bg-[#eef4fa] p-3">
            <WebCapture scenario={s} clientId={clientId} transport={parsed} result={result} problem={problem} event={traffic} />
          </div>
        )}
        {!parsed || !result ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-[12.5px] text-black/50">
            <p>アドレスを入力してください。</p>
            {labServers.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-center gap-2">
                <span>{c.name}</span>
                <button className="font-medium text-[#075aaa] underline" onClick={() => navigate(`http://${c.webService!.host}`)}>HTTP</button>
                <button className="font-medium text-[#075aaa] underline" onClick={() => navigate(`https://${c.webService!.host}`)}>HTTPS</button>
              </div>
            ))}
          </div>
        ) : problem ? (
          <div role="alert" className="space-y-2 p-4">
            <h1 className="font-semibold">{parsed.scheme === "https" ? "TLS 接続に失敗しました" : "HTTP 接続に失敗しました"}</h1>
            <p className="text-[13px]">{problem}</p>
          </div>
        ) : server && result.status === "ok" ? (
          <WebLabSite key={parsed.display} server={server} onTraffic={(event) => recordTraffic(parsed.display, event, false)} />
        ) : (
          <SitePage key={`${url}-${tick}`} result={result} url={parsed.display} host={parsed.host} port={parsed.port} />
        )}
      </div>
    </div>
  );
}

// --- ネットワークユーティリティ（ping / traceroute） --------------------------------

export function NetUtility({ clientId, dark }: { clientId: string; dark?: boolean }) {
  const s = useStore((x) => x.scenario);
  const [tool, setTool] = useState<"ping" | "traceroute">("ping");
  const [host, setHost] = useState("");
  const [out, setOut] = useState<string[]>([]);
  const run = () => {
    const target = host.trim();
    if (!target) return;
    if (tool === "ping") {
      setOut(pingLines(s, clientId, target));
      usePcCapture.getState().record(clientId, () => pingPackets(s, clientId, target));
    } else {
      setOut(tracerouteLines(s, clientId, target));
    }
  };
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex gap-1">
        {(["ping", "traceroute"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTool(t)}
            className={clsx("h-7 rounded px-3 text-[12.5px]", tool === t ? "bg-accent text-white" : dark ? "bg-white/10" : "bg-surface-2 hover:bg-hover")}
          >
            {t === "ping" ? "Ping" : "Traceroute"}
          </button>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <input
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="IP アドレスまたはホスト名"
          className="tnum h-7 flex-1 rounded border border-line bg-surface px-2 text-[12.5px] outline-none focus:border-accent"
        />
        <button className="h-7 rounded bg-accent px-3 text-[12.5px] text-white">実行</button>
      </form>
      <pre className="min-h-0 flex-1 overflow-auto rounded bg-[#1d1f23] p-3 font-mono text-[11.5px] leading-relaxed text-[#d7dae0]">
        {out.length ? out.join("\n") : "結果がここに表示されます"}
      </pre>
    </div>
  );
}

// --- スマートホームアプリ ----------------------------------------------------------

export function SmartHome({ clientId }: { clientId: string }) {
  const s = useStore((x) => x.scenario);
  const [power, setPower] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<Record<string, string>>({});
  const devices = s.clients.filter((c) => c.kind === "iot");

  const toggle = (id: string) => {
    const ip = resolveClient(s, id).ip;
    const p = ip ? probe(s, clientId, ip, "tcp", 80) : null;
    if (!p || p.status !== "ok") {
      setMsg((m) => ({ ...m, [id]: !ip ? "デバイスがオフラインです" : p?.status === "noip" ? "このスマホがネットワークに接続されていません" : "デバイスが応答しません" }));
      return;
    }
    setMsg((m) => ({ ...m, [id]: "" }));
    setPower((x) => ({ ...x, [id]: !x[id] }));
  };

  return (
    <div className="space-y-2">
      {devices.length === 0 && <p className="text-[12.5px] text-muted">登録されたデバイスはありません</p>}
      {devices.map((d) => (
        <div key={d.id} className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-black/5">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">{d.name}</div>
              <div className="text-[11.5px] text-black/50">{power[d.id] ? "オン" : "オフ"}</div>
            </div>
            <button
              onClick={() => toggle(d.id)}
              className={clsx("relative h-6 w-11 rounded-full transition-colors", power[d.id] ? "bg-[#34c759]" : "bg-black/15")}
              aria-label={`${d.name} を切り替え`}
            >
              <span className={clsx("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", power[d.id] ? "left-[22px]" : "left-0.5")} />
            </button>
          </div>
          {msg[d.id] && <p className="mt-1.5 text-[11.5px] text-[#d93025]">{msg[d.id]}</p>}
        </div>
      ))}
    </div>
  );
}

/** 一覧の行（スマホ/TV の設定画面用） */
export function MenuRow({ icon, label, value, onClick, dark }: { icon: React.ReactNode; label: string; value?: string; onClick: () => void; dark?: boolean }) {
  return (
    <button onClick={onClick} className={clsx("flex w-full items-center gap-3 px-3 py-2.5 text-left", dark ? "hover:bg-white/10" : "hover:bg-black/[0.03]")}>
      {icon}
      <span className="flex-1">{label}</span>
      {value && <span className="max-w-[45%] truncate text-[12px] opacity-50">{value}</span>}
      <ChevronRight size={14} className="opacity-40" />
    </button>
  );
}

export function TraceDetails({ hops }: { hops: Parameters<typeof TraceView>[0]["hops"] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-6 text-left">
      <button onClick={() => setOpen(!open)} className="text-[12px] font-medium text-[#b26a00]">
        {open ? "▾" : "▸"} 学習用: パケットの経路を見る
      </button>
      {open && (
        <div className="mt-2 rounded border border-black/10 bg-white p-3 text-[#222]">
          <TraceView hops={hops} compact />
        </div>
      )}
    </div>
  );
}

// --- mDNS で見つけた機器に接続するアプリ（キャスト / プリンター） ----------------------

export function DiscoveryApp({
  clientId,
  types,
  verb,
  success,
  emptyText,
}: {
  clientId: string;
  types: string[];
  verb: string;
  success: (name: string) => string;
  emptyText: string;
}) {
  const s = useStore((x) => x.scenario);
  const [scan, setScan] = useState(0);
  const [status, setStatus] = useState<Record<string, { ok: boolean; text: string; why?: string }>>({});
  const found = useMemo(
    () => discover(s, clientId, types),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s, clientId, scan],
  );
  const visible = found.filter((f) => f.visible);
  const hidden = found.filter((f) => !f.visible);
  // 同じ端末が複数サービスを広告していても 1 行にまとめる（接続には最初のサービスを使う）
  const devices = visible.filter((f, i) => visible.findIndex((x) => x.client.id === f.client.id) === i);
  const servicesOf = (id: string) => visible.filter((x) => x.client.id === id).map((x) => x.service.label).join(" · ");

  const connect = (f: (typeof visible)[number]) => {
    const p = f.ip ? probe(s, clientId, f.ip, "tcp", f.service.port) : null;
    const ok = p?.status === "ok";
    setStatus((x) => ({
      ...x,
      [f.client.id]: ok
        ? { ok, text: success(f.client.name) }
        : {
            ok,
            text: "接続できませんでした",
            why:
              p?.status === "timeout"
                ? `見つけることはできましたが、${f.service.label} (TCP/${f.service.port}) の通信がファイアウォールで止められています。mDNS の中継とファイアウォールの許可は別物です。`
                : p?.status === "refused"
                  ? `TCP/${f.service.port} で応答がありません。`
                  : p && "message" in p
                    ? p.message
                    : undefined,
          },
    }));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-[12px] opacity-70">
        <span>近くのデバイス</span>
        <button onClick={() => setScan((n) => n + 1)} className="inline-flex items-center gap-1 hover:opacity-100">
          <RotateCw size={11} /> 再検索
        </button>
      </div>
      {devices.length === 0 ? (
        <p className="rounded-lg bg-black/[0.04] px-3 py-4 text-center text-[12.5px] opacity-70">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-black/5 overflow-hidden rounded-lg bg-white ring-1 ring-black/5">
          {devices.map((f) => {
            const st = status[f.client.id];
            return (
              <li key={f.client.id} className="px-3 py-2.5 text-[#111]">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{f.client.name}</div>
                    <div className="text-[11px] text-black/50">{servicesOf(f.client.id)}</div>
                  </div>
                  <button onClick={() => connect(f)} className="h-7 rounded-full bg-[#007aff] px-3 text-[12px] text-white">
                    {verb}
                  </button>
                </div>
                {st && <p className={clsx("mt-1.5 text-[11.5px]", st.ok ? "text-[#1e8e3e]" : "text-[#d93025]")}>{st.text}</p>}
                {st?.why && (
                  <div className="mt-1.5">
                    <WhyBox text={st.why} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {hidden.length > 0 && (
        <WhyBox
          text={[...new Map(hidden.map((f) => [f.client.id, f])).values()].map((f) => `${f.client.name}: ${f.reason}`).join("\n")}
        />
      )}
    </div>
  );
}
