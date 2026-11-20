"use client";

import clsx from "clsx";
import { useStore } from "@/lib/store";
import { WEB_TLS } from "@/lib/web";
import { Select } from "@/components/ui";
import { WhyBox, WifiList, useEmu } from "./apps";

/** プリンター / NAS / IoT 機器の前面パネル */
export function Appliance({ clientId }: { clientId: string }) {
  const { client, info } = useEmu(clientId);
  const renew = useStore((x) => x.renewLease);
  const mutate = useStore((x) => x.mutate);
  const st = info.st;
  const linkDown = st.errorStage === "attach";
  const led = linkDown ? "bg-err" : st.error ? "bg-warn animate-pulse" : "bg-ok";

  const lcd =
    client.kind === "printer"
      ? [linkDown ? "LAN: 未接続" : st.error ? "IP 取得エラー" : "印刷可能", st.ip ? `IP: ${st.ip}` : "IP: ---"]
      : client.kind === "server"
        ? [linkDown ? "LAN1: Link Down" : st.error ? "Network Error" : "System Ready", st.ip ? `${st.ip}` : "0.0.0.0"]
        : [linkDown ? "未接続" : st.error ? "ネットワーク接続待ち" : "接続済み", st.ip ?? ""];

  return (
    <div className="space-y-4 p-4">
      <div className="rounded-lg border border-line bg-[linear-gradient(180deg,#f4f5f7,#e6e8ec)] p-4 dark:bg-none">
        <div className="mb-3 flex items-center gap-3">
          <span className={clsx("size-3 rounded-full shadow-[0_0_6px_currentColor]", led)} />
          <span className="text-[12px] text-muted">{client.vendor}</span>
          <span className="ml-auto font-mono text-[10.5px] text-muted">{client.mac}</span>
        </div>
        {client.kind !== "iot" ? (
          <div className="rounded bg-[#1e2a22] px-3 py-2 font-mono text-[12.5px] leading-relaxed text-[#9fe2a8]">
            {lcd.map((l, i) => (
              <div key={i}>{l || " "}</div>
            ))}
          </div>
        ) : (
          <div className="text-[12.5px]">
            ステータスランプ: <span className="font-medium">{linkDown ? "赤 (未接続)" : st.error ? "黄点滅 (IP 待ち)" : "緑 (接続済み)"}</span>
            {st.ip && <div className="tnum mt-1 text-muted">IP {st.ip}</div>}
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <button onClick={() => renew(clientId)} className="h-7 rounded border border-line bg-surface px-3 text-[12px] hover:bg-hover">
            ネットワークを再接続
          </button>
        </div>
      </div>
      {client.kind === "server" && client.webService && (
        <div className="space-y-2 rounded border border-line bg-surface p-3 text-[12px]">
          <p className="font-medium">{client.webService.kind === "forum" ? "会員制掲示板" : "Web サイト"}</p>
          <p className="font-mono">http://{client.webService.host}</p>
          {client.webService.tls !== "disabled" && <p className="font-mono">https://{client.webService.host}</p>}
          <label className="block space-y-1">
            <span>TLS 証明書</span>
            <Select value={client.webService.tls} options={Object.entries(WEB_TLS).map(([value, label]) => ({ value, label }))} onChange={(v) => mutate((s) => {
              const service = s.clients.find((c) => c.id === clientId)?.webService;
              if (service) service.tls = v as keyof typeof WEB_TLS;
            })} />
          </label>
        </div>
      )}
      {client.connection.type === "wifi" && (
        <div>
          <div className="mb-2 text-[12px] font-medium text-muted">Wi-Fi セットアップ</div>
          <WifiList clientId={clientId} />
        </div>
      )}
      <WhyBox text={st.error} />
    </div>
  );
}
