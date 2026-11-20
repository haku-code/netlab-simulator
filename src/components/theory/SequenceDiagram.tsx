"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";

export interface SeqMessage {
  from: string;
  to: string;
  label: string;
  detail?: string;
  /** 途中で破棄される（× を表示） */
  dropped?: boolean;
  /** 自分自身への処理（タイムアウト・キャッシュ等） */
  self?: boolean;
  tone?: "ok" | "err" | "muted";
}

/** 参加者を縦線、メッセージを矢印で描くシーケンス図。1 ステップずつ再生できる */
export function SequenceDiagram({ participants, messages }: { participants: string[]; messages: SeqMessage[] }) {
  const [shown, setShown] = useState(messages.length);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    setShown(messages.length);
    setPlaying(false);
  }, [messages]);
  useEffect(() => {
    if (!playing) return;
    if (shown >= messages.length) return setPlaying(false);
    const t = setTimeout(() => setShown((n) => n + 1), 700);
    return () => clearTimeout(t);
  }, [playing, shown, messages.length]);

  const col = 100 / participants.length;
  const x = (p: string) => (participants.indexOf(p) + 0.5) * col;
  const ROW = 46;
  const height = 40 + messages.length * ROW + 10;

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <button
          onClick={() => {
            setShown(0);
            setPlaying(true);
          }}
          className="h-7 rounded border border-line bg-surface px-2.5 text-[12px] hover:bg-hover"
        >
          ▶ 再生
        </button>
        <button onClick={() => setShown((n) => Math.min(messages.length, n + 1))} className="h-7 rounded border border-line bg-surface px-2.5 text-[12px] hover:bg-hover">
          1 ステップ
        </button>
        <span className="tnum text-[12px] text-muted">
          {shown} / {messages.length}
        </span>
      </div>
      <div className="relative overflow-x-auto">
        <div className="relative min-w-[560px]" style={{ height }}>
          {/* 参加者 */}
          {participants.map((p) => (
            <div key={p} className="absolute top-0 -translate-x-1/2 text-center" style={{ left: `${x(p)}%` }}>
              <div className="rounded border border-line bg-surface px-2 py-1 text-[12px] font-medium whitespace-nowrap">{p}</div>
            </div>
          ))}
          <svg className="absolute inset-0 h-full w-full overflow-visible" preserveAspectRatio="none">
            {participants.map((p) => (
              <line key={p} x1={`${x(p)}%`} x2={`${x(p)}%`} y1={30} y2={height} stroke="var(--line)" strokeDasharray="3 3" />
            ))}
          </svg>
          {/* メッセージ */}
          {messages.slice(0, shown).map((m, i) => {
            const y = 44 + i * ROW;
            const a = x(m.from);
            const b = x(m.to);
            const left = Math.min(a, b);
            const width = Math.abs(b - a);
            const color = m.tone === "err" || m.dropped ? "var(--err)" : m.tone === "muted" ? "var(--faint)" : "var(--accent)";
            if (m.self || m.from === m.to) {
              return (
                <div key={i} className="absolute" style={{ top: y, left: `${a}%` }}>
                  <div className={clsx("ml-2 rounded px-1.5 py-0.5 text-[11.5px] whitespace-nowrap", m.tone === "err" ? "bg-err/10 text-err" : "bg-surface-2 text-fg-2")}>
                    ↻ {m.label}
                  </div>
                  {m.detail && <div className="ml-2 text-[10.5px] whitespace-nowrap text-muted">{m.detail}</div>}
                </div>
              );
            }
            const reach = m.dropped ? 0.55 : 1;
            return (
              <div key={i} className="absolute" style={{ top: y, left: `${left}%`, width: `${width}%` }}>
                <div className={clsx("text-center text-[11.5px] font-medium whitespace-nowrap", m.dropped || m.tone === "err" ? "text-err" : "text-fg")}>{m.label}</div>
                <div className="relative h-2.5">
                  <div
                    className="absolute top-[4px] h-[1.5px]"
                    style={{ background: color, width: `${reach * 100}%`, ...(a < b ? { left: 0 } : { right: 0 }) }}
                  />
                  {m.dropped ? (
                    <span
                      className="absolute -top-[5px] -translate-x-1/2 text-[13px] font-bold text-err"
                      style={{ left: a < b ? `${reach * 100}%` : `${(1 - reach) * 100}%` }}
                    >
                      ✕
                    </span>
                  ) : (
                    <span
                      className="absolute top-0 size-0 border-y-[5px] border-y-transparent"
                      style={a < b ? { right: 0, borderLeft: `7px solid ${color}` } : { left: 0, borderRight: `7px solid ${color}` }}
                    />
                  )}
                </div>
                {m.detail && <div className="text-center text-[10.5px] whitespace-nowrap text-muted">{m.detail}</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
