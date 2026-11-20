"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";
import type { Frame } from "@/lib/capture";

const changedCls = "bg-warn/20 font-semibold text-fg";

/** Wireshark 風のパケット一覧 + 選択したフレームのヘッダー詳細 */
export function CaptureView({ frames, wirelessTools = false }: { frames: Frame[]; wirelessTools?: boolean }) {
  const [sel, setSel] = useState(0);
  const [wireless, setWireless] = useState(false);
  const canObserve = wirelessTools && frames.some((f) => f.medium === "wifi");
  const observing = canObserve && wireless;
  const shown = observing ? frames.filter((f) => f.medium === "wifi") : frames;
  useEffect(() => {
    const first = frames.filter((frame) => !observing || frame.medium === "wifi").findIndex((frame) => frame.kind === "data");
    setSel(Math.max(0, first));
  }, [frames, observing]);
  if (!frames.length) return <p className="px-4 py-6 text-center text-muted">送信元が IP を持っていないため、パケットを送れません。</p>;
  const f = shown[Math.min(sel, shown.length - 1)];
  const encrypted = observing && f.wifi?.radio === "protected";
  const c = (k: keyof Frame) => f.changed.includes(k);

  return (
    <div>
      {canObserve && (
        <div className="mb-3 space-y-1 text-[12px]">
          <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={observing} onChange={(e) => setWireless(e.target.checked)} />無線区間を観測</label>
          {observing && <p className="text-muted">WEP や初代 WPA は、無線側の保護が破られた場合の例として表示します。</p>}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="tnum w-full font-mono text-[11.5px]">
          <thead>
            <tr className="text-left text-muted">
              {["No.", "区間", "送信元 MAC", "宛先 MAC", "VLAN", "送信元 IP", "宛先 IP", "TTL", "プロトコル", "概要"].map((h) => (
                <th key={h} className="border-b border-line px-2 py-1.5 font-sans text-[11px] font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((x, i) => {
              const ch = (k: keyof Frame) => (x.changed.includes(k) ? changedCls : "");
              const hidden = observing && x.wifi?.radio === "protected";
              return (
                <tr
                  key={x.no}
                  onClick={() => setSel(i)}
                  className={clsx(
                    "cursor-pointer border-b border-line-soft whitespace-nowrap",
                    i === sel ? "bg-accent-soft" : x.dropped ? "bg-err/5" : x.kind !== "data" ? "bg-[#f6f0ff] dark:bg-[#2a2440]" : "hover:bg-hover",
                  )}
                >
                  <td className="px-2 py-1">{x.no}</td>
                  <td className="px-2 py-1 font-sans">
                    {x.from} → {x.to}
                  </td>
                  <td className={clsx("px-2 py-1", ch("ethSrc"))}>{x.ethSrc}</td>
                  <td className={clsx("px-2 py-1", ch("ethDst"))}>{x.ethDst}</td>
                  <td className={clsx("px-2 py-1", ch("vlan"))}>{observing ? "—" : x.vlan ?? "—"}</td>
                  <td className={clsx("px-2 py-1", ch("ipSrc"))}>{hidden ? "—" : x.ipSrc ?? ""}</td>
                  <td className={clsx("px-2 py-1", ch("ipDst"))}>{hidden ? "—" : x.ipDst ?? ""}</td>
                  <td className={clsx("px-2 py-1", ch("ttl"))}>{hidden ? "—" : x.ttl ?? ""}</td>
                  <td className="px-2 py-1">{hidden ? "802.11" : x.medium === "wifi" && x.kind === "data" ? `802.11/${x.protocol}` : x.protocol}</td>
                  <td className={clsx("px-2 py-1 font-sans", x.dropped && "text-err")}>{hidden ? "フレーム本体は暗号化" : x.dropped ? `✕ ${x.info}` : x.info}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-2 text-[11.5px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-warn/30" /> 前のフレームから変わった値
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-[#e9dcff]" /> ARP
        </span>
      </div>

      {/* 選択したフレームの詳細（ヘッダーの入れ子） */}
      <div className="mt-3 rounded border border-line bg-surface-2 p-3 font-mono text-[11.5px] leading-relaxed">
        <div className="mb-1 font-sans text-[12px] font-semibold">
          フレーム {f.no}: {f.from} → {f.to}
        </div>
        <Layer title={f.medium === "wifi" ? "IEEE 802.11 (Wi-Fi)" : f.medium === "wan" ? "Ethernet II (WAN)" : "Ethernet II"}>
          <Field k="送信元" v={f.ethSrc} hl={c("ethSrc")} />
          <Field k="宛先" v={f.ethDst} hl={c("ethDst")} />
          {f.wifi && <Field k="Wi-Fi 方式" v={f.wifi.label} />}
        </Layer>
        {!observing && f.vlan !== null && (
          <Layer title="802.1Q VLAN">
            <Field k="VLAN ID" v={String(f.vlan)} hl={c("vlan")} />
          </Layer>
        )}
        {encrypted ? <div className="mt-1">フレーム本体は暗号化されています。</div> : f.kind !== "data" ? (
          <Layer title="ARP（アドレス解決プロトコル）">
            <Field k="操作コード" v={f.kind === "arp-request" ? "要求 (1)" : "応答 (2)"} />
            <Field k="" v={f.info} />
          </Layer>
        ) : (
          <>
            <Layer title="IPv4（インターネットプロトコル）">
              <Field k="送信元" v={f.ipSrc ?? ""} hl={c("ipSrc")} />
              <Field k="宛先" v={f.ipDst ?? ""} hl={c("ipDst")} />
              <Field k="TTL（生存時間）" v={String(f.ttl)} hl={c("ttl")} />
              <Field k="プロトコル" v={f.protocol} />
            </Layer>
            {f.protocol !== "ICMP" ? (
              <Layer title={f.protocol === "TCP" ? "TCP（伝送制御プロトコル）" : "UDP（ユーザーデータグラムプロトコル）"}>
                <Field k="送信元ポート" v={String(f.srcPort)} />
                <Field k="宛先ポート" v={String(f.dstPort)} />
                {f.protocol === "TCP" && <Field k="フラグ" v="SYN" />}
              </Layer>
            ) : (
              <Layer title="ICMP（インターネット制御メッセージプロトコル）">
                <Field k="種類" v="8（エコー要求 / ping）" />
              </Layer>
            )}
          </>
        )}
        {!encrypted && (f.note || f.dropped) && (
          <div className={clsx("mt-2 font-sans text-[12px]", f.dropped ? "text-err" : "text-fg-2")}>{f.dropped ?? f.note}</div>
        )}
      </div>
    </div>
  );
}

function Layer({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-1">
      <div className="text-fg">▾ {title}</div>
      <div className="pl-5">{children}</div>
    </div>
  );
}

function Field({ k, v, hl }: { k: string; v: string; hl?: boolean }) {
  return (
    <div className="text-fg-2">
      {k && <span>{k}: </span>}
      <span className={clsx(hl && changedCls, "rounded px-0.5")}>{v}</span>
      {hl && <span className="ml-2 font-sans text-[10.5px] text-warn">← 変化</span>}
    </div>
  );
}
