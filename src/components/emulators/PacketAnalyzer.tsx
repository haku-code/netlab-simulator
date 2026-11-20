"use client";

import clsx from "clsx";
import { Circle, Pause, Play } from "lucide-react";
import { useState } from "react";
import { usePcCapture, type CapturedPacket } from "@/lib/pc-capture";
import { PACKET_PROTOCOLS, type PacketProtocol } from "@/lib/pc-packets";

const NO_FRAMES: CapturedPacket[] = [];

const COLORS: Record<PacketProtocol, string> = {
  DNS: "text-[#a5d9fe]",
  TCP: "text-[#b4e5d7]",
  TLS: "text-[#cec1ff]",
  HTTP: "text-[#ffd89e]",
  ICMP: "text-[#f4bfcb]",
};

function sampleHex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const rows: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const row = [...bytes.slice(offset, offset + 16)];
    const hex = row.map((b) => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = row.map((b) => b >= 32 && b <= 126 ? String.fromCharCode(b) : ".").join("");
    rows.push(`${offset.toString(16).padStart(4, "0")}   ${hex.padEnd(47)}  ${ascii}`);
  }
  return rows.join("\n");
}

export function PacketAnalyzer({ clientId }: { clientId: string }) {
  const session = usePcCapture((s) => s.sessions[clientId]);
  const start = usePcCapture((s) => s.start);
  const stop = usePcCapture((s) => s.stop);
  const [protocol, setProtocol] = useState("");
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<number | null>(null);
  const frames = session?.frames ?? NO_FRAMES;
  const term = query.trim().toLowerCase();
  const visible = frames.filter((frame) => (!protocol || frame.protocol === protocol)
    && (!term || [frame.source, frame.destination, frame.summary, frame.sourcePort, frame.destinationPort].some((v) => String(v ?? "").toLowerCase().includes(term))));
  const selected = visible.find((frame) => frame.no === selection) ?? visible[0];
  const running = session?.running ?? false;
  const button = "flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[11.5px] font-medium transition-colors focus-visible:outline focus-visible:outline-sky-300";

  return (
    <section aria-label="パケット解析" className="flex h-full min-h-0 flex-col bg-[#101923] text-[#dce8f4]">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#2c4052] bg-[#192939] px-3 py-2">
        <button
          type="button"
          className={clsx(button, "border-[#3d7267] bg-[#224742] hover:bg-[#2a554c] disabled:opacity-50")}
          disabled={running}
          onClick={() => {
            start(clientId);
            setSelection(null);
          }}
        >
          <Play size={12} /> {!running && frames.length ? "新規キャプチャ" : "キャプチャ開始"}
        </button>
        <button type="button" className={clsx(button, "border-[#52677c] hover:bg-[#263a4e] disabled:opacity-50")} disabled={!running} onClick={() => stop(clientId)}>
          <Pause size={12} /> 停止
        </button>
        <span role="status" className="ml-auto flex items-center gap-1.5 text-[11px]">
          <Circle size={8} fill="currentColor" className={running ? "text-[#5ee0ba]" : "text-[#91a4b7]"} />
          {running ? "記録中" : "停止中"}
        </span>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#2c4052] px-3 py-1.5 text-[11px]">
        <select aria-label="プロトコルで絞り込む" value={protocol} onChange={(e) => setProtocol(e.target.value)} className="h-7 rounded border border-[#506579] bg-[#1c2b3b] px-1.5">
          <option value="">全プロトコル</option>
          {PACKET_PROTOCOLS.map((p) => <option key={p}>{p}</option>)}
        </select>
        <input aria-label="パケットを検索" placeholder="IP・ポート・概要で検索" value={query} onChange={(e) => setQuery(e.target.value)} className="h-7 min-w-20 flex-1 rounded border border-[#506579] bg-[#1c2b3b] px-2 placeholder:text-[#aab9ca]" />
        <span className="shrink-0 font-mono text-[#aab9ca]">{visible.length} / {frames.length} 件</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {visible.length ? (
          <table className="w-full min-w-[445px] border-collapse text-left text-[11px]">
            <thead className="sticky top-0 z-10 bg-[#1c2b3b] text-[#b9cbdd]">
              <tr>
                {["No.", "秒", "送信元", "宛先", "方式", "概要"].map((label) => <th scope="col" key={label} className="px-2 py-1.5 font-medium whitespace-nowrap">{label}</th>)}
              </tr>
            </thead>
            <tbody className="font-mono">
              {visible.map((frame) => (
                <tr key={frame.no} onClick={() => setSelection(frame.no)} className={clsx("cursor-pointer border-b border-[#253441] hover:bg-[#1f3344]", frame.no === selected?.no && "bg-[#203d49]")}>
                  <td className="px-2 py-1"><button type="button" aria-label={`フレーム ${frame.no} ${frame.protocol}`} aria-pressed={frame.no === selected?.no} onClick={() => setSelection(frame.no)} className="underline-offset-2 hover:underline">{frame.no}</button></td>
                  <td className="px-2 py-1">{(frame.time / 1000).toFixed(3)}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{frame.source}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{frame.destination}</td>
                  <td className={clsx("px-2 py-1 font-semibold", COLORS[frame.protocol])}>{frame.protocol}</td>
                  <td className="px-2 py-1 break-words">{frame.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="grid h-full min-h-24 place-content-center gap-1 px-4 text-center text-[12px]">
            <p className="font-medium">{frames.length ? "条件に一致するパケットがありません。" : "キャプチャしたパケットはありません。"}</p>
            {!frames.length && <p className="text-[#aab9ca]">開始後、この PC のブラウザでサイトを開くか Ping を実行してください。</p>}
          </div>
        )}
      </div>
      {selected && (
        <div className="grid h-[125px] shrink-0 grid-cols-[minmax(155px,2fr)_minmax(0,3fr)] overflow-hidden border-t border-[#41576a] bg-[#152230] text-[11px]">
          <div className="overflow-auto border-r border-[#41576a] p-2.5">
            <h2 className="mb-1 font-semibold">フレーム {selected.no} · {selected.protocol}</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 break-words">
              <dt className="text-[#aab9ca]">送信元</dt><dd>{selected.source}{selected.sourcePort && `:${selected.sourcePort}`}</dd>
              <dt className="text-[#aab9ca]">宛先</dt><dd>{selected.destination}{selected.destinationPort && `:${selected.destinationPort}`}</dd>
              <dt className="text-[#aab9ca]">概要</dt><dd>{selected.summary}</dd>
            </dl>
          </div>
          <div className="min-w-0 overflow-auto p-2.5">
            <h2 className="mb-1 font-semibold">サンプルデータの16進表示</h2>
            {selected.sample
              ? <pre className="font-mono text-[10px] leading-relaxed text-[#b5ead9]">{sampleHex(selected.sample)}</pre>
              : <p className="text-[#aab9ca]">{selected.protocol === "TLS" && selected.summary.startsWith("Application Data") ? "TLS のアプリケーションデータは暗号化されています。" : "このフレームには表示用のサンプルデータがありません。"}</p>}
          </div>
        </div>
      )}
      <p className="shrink-0 border-t border-[#2c4052] px-3 py-1 text-[10px] text-[#aab9ca]">この PC の仮想通信 · 最新500件</p>
    </section>
  );
}
