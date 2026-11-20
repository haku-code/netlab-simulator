"use client";

import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { parseCidr, ipToStr } from "@/lib/net/ip";
import { dijkstraSteps, lookup, nextHops, OSPF_EDGES, OSPF_NODES, randomDest, ROUTES, type GEdge } from "@/lib/theory/routing";
import { BRIDGES, bridgeIdStr, computeStp, LINKS, type PortRole, type StpBridge, type StpLink } from "@/lib/theory/stp";
import { checkAnswer, DRILL_LABEL, makeQuestion, toBinary, type DrillKind, type DrillQuestion } from "@/lib/theory/subnet";
import { Button, Input, Select, Toggle } from "../ui";

// --- サブネット計算ドリル ------------------------------------------------------------

const KINDS = Object.keys(DRILL_LABEL) as DrillKind[];

export function SubnetDrill() {
  const [kind, setKind] = useState<DrillKind | "mix">("mix");
  const [q, setQ] = useState<DrillQuestion | null>(null);
  const [input, setInput] = useState("");
  const [result, setResult] = useState<boolean | null>(null);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);

  const next = (k = kind) => {
    setQ(makeQuestion(k === "mix" ? KINDS[Math.floor(Math.random() * KINDS.length)] : k));
    setInput("");
    setResult(null);
  };
  useEffect(() => next(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (v = input) => {
    if (!q || result !== null) return;
    const ok = checkAnswer(q, v);
    setResult(ok);
    setStreak((n) => (ok ? n + 1 : 0));
    if (ok) setBest((b) => Math.max(b, streak + 1));
  };

  if (!q) return null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {(["mix", ...KINDS] as const).map((k) => (
          <button
            key={k}
            onClick={() => {
              setKind(k);
              next(k);
            }}
            className={clsx("h-7 rounded border px-2.5 text-[12px]", kind === k ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-fg-2 hover:bg-hover")}
          >
            {k === "mix" ? "ミックス" : DRILL_LABEL[k]}
          </button>
        ))}
        <span className="tnum ml-auto text-[12px] text-muted">
          連続正解 <b className="text-fg">{streak}</b> / 最高 {best}
        </span>
      </div>
      <div className="rounded border border-line bg-surface p-4">
        <div className="mb-3 text-[15px] font-medium">{q.prompt}</div>
        {q.choices ? (
          <div className="flex gap-2">
            {q.choices.map((c) => (
              <Button key={c} onClick={() => submit(c)} disabled={result !== null}>
                {c}
              </Button>
            ))}
          </div>
        ) : (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Input className="tnum max-w-sm font-mono" value={input} placeholder={q.placeholder} onChange={(e) => setInput(e.target.value)} disabled={result !== null} autoFocus />
            <Button variant="primary" disabled={result !== null || !input.trim()}>
              答え合わせ
            </Button>
          </form>
        )}
        {result !== null && (
          <div className="mt-3 space-y-2">
            <div className={clsx("font-medium", result ? "text-ok" : "text-err")}>{result ? "正解！" : `不正解。正解は ${q.answer}`}</div>
            <pre className="overflow-x-auto rounded bg-surface-2 p-3 font-mono text-[11.5px] leading-relaxed text-fg-2">{q.explain.join("\n")}</pre>
            <Button variant="primary" onClick={() => next()}>
              次の問題
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// --- 最長一致 -------------------------------------------------------------------

export function LpmLab() {
  const [dest, setDest] = useState("10.1.2.200");
  const [pick, setPick] = useState<number | null>(null);
  const { matches, best } = useMemo(() => lookup(ROUTES, dest), [dest]);
  const bestIdx = best ? ROUTES.indexOf(best) : -1;
  const reveal = pick !== null;
  const bits = (cidr: string) => {
    // /0（デフォルトルート）は parseCidr の対象外なので個別に扱う
    const sn = parseCidr(cidr);
    return sn ? { net: toBinary(ipToStr(sn.network)), prefix: sn.prefix } : { net: "", prefix: 0 };
  };
  const destBits = toBinary(dest);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span>
          宛先 IP: <b className="tnum font-mono text-[15px]">{dest}</b>
        </span>
        <Button
          onClick={() => {
            let d = randomDest();
            while (d === dest) d = randomDest();
            setDest(d);
            setPick(null);
          }}
        >
          別の宛先
        </Button>
        <span className="text-[12px] text-muted">どの経路が使われる？ 行をクリックして選んでください。</span>
      </div>
      <div className="overflow-x-auto rounded border border-line">
        <table className="tnum w-full text-left text-[12.5px]">
          <thead>
            <tr className="text-muted">
              <th className="border-b border-line px-3 py-1.5 font-medium">宛先ネットワーク</th>
              <th className="border-b border-line px-3 py-1.5 font-medium">ネクストホップ</th>
              <th className="border-b border-line px-3 py-1.5 font-medium">出力先</th>
              {reveal && <th className="border-b border-line px-3 py-1.5 font-medium">ネットワーク部の比較 (2 進数)</th>}
            </tr>
          </thead>
          <tbody>
            {ROUTES.map((r, i) => {
              const m = matches.includes(r);
              const b = bits(r.prefix);
              return (
                <tr
                  key={r.prefix}
                  onClick={() => !reveal && setPick(i)}
                  className={clsx(
                    "border-b border-line-soft last:border-0",
                    !reveal && "cursor-pointer hover:bg-hover",
                    reveal && i === bestIdx && "bg-ok/10",
                    reveal && pick === i && i !== bestIdx && "bg-err/10",
                    reveal && !m && "opacity-45",
                  )}
                >
                  <td className="px-3 py-1.5 font-mono">{r.prefix}</td>
                  <td className="px-3 py-1.5 font-mono">{r.nextHop}</td>
                  <td className="px-3 py-1.5">{r.iface}</td>
                  {reveal && (
                    <td className="px-3 py-1.5 font-mono text-[11px]">
                      {b.prefix === 0 ? (
                        <span className="text-muted">/0: 比較するビットなし（常に一致）</span>
                      ) : (
                        <>
                          <span className={m ? "text-ok" : "text-err"}>{b.net.replace(/\./g, "").slice(0, b.prefix)}</span>
                          <span className="text-muted"> vs </span>
                          <span>{destBits.replace(/\./g, "").slice(0, b.prefix)}</span>
                          <span className="ml-2 font-sans">{m ? `一致 (/${b.prefix})` : "不一致"}</span>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {reveal && (
        <p className={clsx("font-medium", pick === bestIdx ? "text-ok" : "text-err")}>
          {pick === bestIdx ? "正解！" : "残念。"} 一致した {matches.length} 本のうち、プレフィックスが最も長い {best?.prefix} が選ばれ、{best?.iface} へ送られます。
        </p>
      )}
    </div>
  );
}

// --- ダイクストラ法 ---------------------------------------------------------------

const COSTS = [1, 2, 3, 5, 10, 0];

export function DijkstraLab() {
  const [edges, setEdges] = useState<GEdge[]>(OSPF_EDGES);
  const [source, setSource] = useState("R1");
  const steps = useMemo(() => dijkstraSteps(OSPF_NODES, edges, source), [edges, source]);
  const [step, setStep] = useState(0);
  useEffect(() => setStep(0), [edges, source]);
  const cur = step > 0 ? steps[step - 1] : null;
  const finished = step >= steps.length;
  const nh = finished && cur ? nextHops(source, cur.prev) : null;
  const pos = Object.fromEntries(OSPF_NODES.map((n) => [n.id, n]));

  const cycle = (i: number) =>
    setEdges((es) =>
      es.map((e, k) => {
        if (k !== i) return e;
        const idx = e.up ? COSTS.indexOf(e.cost) : COSTS.length - 1;
        const next = COSTS[(idx + 1) % COSTS.length];
        return next === 0 ? { ...e, up: false } : { ...e, up: true, cost: next };
      }),
    );
  const inTree = (e: GEdge) => cur && (cur.prev[e.a] === e.b || cur.prev[e.b] === e.a) && cur.done.includes(e.a) && cur.done.includes(e.b);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-muted">始点</span>
        <Select className="w-24" value={source} onChange={setSource} options={OSPF_NODES.map((n) => ({ value: n.id, label: n.id }))} />
        <Button onClick={() => setStep((n) => Math.min(steps.length, n + 1))} disabled={finished} variant="primary">
          次のステップ
        </Button>
        <Button onClick={() => setStep(steps.length)}>最後まで</Button>
        <Button onClick={() => setStep(0)}>リセット</Button>
        <span className="text-[12px] text-muted">リンクのコストをクリックで変更（1→2→3→5→10→切断）</span>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
        <svg viewBox="0 0 590 310" className="w-full rounded border border-line bg-surface">
          {edges.map((e, i) => {
            const a = pos[e.a];
            const b = pos[e.b];
            const tree = inTree(e);
            return (
              <g key={i} onClick={() => cycle(i)} className="cursor-pointer">
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={!e.up ? "var(--faint)" : tree ? "var(--ok)" : "var(--line)"} strokeWidth={tree ? 4 : 2.5} strokeDasharray={e.up ? undefined : "5 5"} />
                <rect x={(a.x + b.x) / 2 - 14} y={(a.y + b.y) / 2 - 10} width={28} height={20} rx={4} fill="var(--surface)" stroke="var(--line)" />
                <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 + 4} textAnchor="middle" fontSize="11" fill={e.up ? "var(--fg)" : "var(--muted)"}>
                  {e.up ? e.cost : "×"}
                </text>
              </g>
            );
          })}
          {OSPF_NODES.map((n) => {
            const done = cur?.done.includes(n.id);
            const settled = cur?.settled === n.id;
            const relaxed = cur?.relaxed.includes(n.id);
            const d = cur ? cur.dist[n.id] : n.id === source ? 0 : Infinity;
            return (
              <g key={n.id}>
                <circle cx={n.x} cy={n.y} r={22} fill={settled ? "var(--accent)" : done ? "var(--ok)" : "var(--surface)"} stroke={relaxed ? "var(--warn)" : "var(--faint)"} strokeWidth={relaxed ? 3 : 1.5} />
                <text x={n.x} y={n.y + 4} textAnchor="middle" fontSize="12" fontWeight="600" fill={done || settled ? "#fff" : "var(--fg)"}>
                  {n.id}
                </text>
                {/* 距離ラベル: 下段のノードは下側に出してリンクのコストと重ならないようにする */}
                <text x={n.x} y={n.y > 200 ? n.y + 38 : n.y - 28} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--accent)">
                  {d === Infinity ? "∞" : d}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="space-y-3 text-[12.5px]">
          <div className="rounded border border-line">
            <div className="border-b border-line bg-surface-2 px-3 py-1.5 font-semibold">
              ステップ {step} / {steps.length}
            </div>
            <div className="px-3 py-2 text-fg-2">
              {!cur ? `${source} の距離を 0、他を ∞ にして開始します。` : `${cur.settled} を確定（距離 ${cur.dist[cur.settled]}）。${cur.relaxed.length ? `${cur.relaxed.join(", ")} の距離を更新。` : "更新なし。"}`}
            </div>
          </div>
          <table className="tnum w-full rounded border border-line">
            <thead>
              <tr className="text-muted">
                <th className="border-b border-line px-2 py-1 text-left font-medium">ノード</th>
                <th className="border-b border-line px-2 py-1 text-left font-medium">距離</th>
                <th className="border-b border-line px-2 py-1 text-left font-medium">{finished ? "次ホップ" : "直前"}</th>
              </tr>
            </thead>
            <tbody>
              {OSPF_NODES.map((n) => (
                <tr key={n.id} className={clsx(cur?.done.includes(n.id) && "text-ok")}>
                  <td className="px-2 py-1">{n.id}</td>
                  <td className="px-2 py-1">{cur ? (cur.dist[n.id] === Infinity ? "∞" : cur.dist[n.id]) : n.id === source ? 0 : "∞"}</td>
                  <td className="px-2 py-1">{n.id === source ? "—" : finished ? (nh?.[n.id] ?? "到達不能") : (cur?.prev[n.id] ?? "—")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// --- STP -----------------------------------------------------------------------

const ROLE_STYLE: Record<PortRole, { label: string; color: string }> = {
  root: { label: "RP", color: "var(--accent)" },
  designated: { label: "DP", color: "var(--ok)" },
  blocked: { label: "✕", color: "var(--err)" },
};

export function StpLab() {
  const [bridges, setBridges] = useState<StpBridge[]>(BRIDGES);
  const [links, setLinks] = useState<StpLink[]>(LINKS);
  const [stpOn, setStpOn] = useState(true);
  const [storm, setStorm] = useState(1);
  const r = useMemo(() => computeStp(bridges, links), [bridges, links]);
  const pos = Object.fromEntries(bridges.map((b) => [b.id, b]));
  const upLinks = links.filter((l) => l.up).length;
  const hasLoop = upLinks > bridges.length - 1;
  const storming = !stpOn && hasLoop;

  useEffect(() => {
    if (!storming) return setStorm(1);
    const t = setInterval(() => setStorm((n) => Math.min(n * 2, 1e9)), 350);
    return () => clearInterval(t);
  }, [storming]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2">
          <Toggle checked={stpOn} onChange={setStpOn} /> STP
        </label>
        <span className="text-[12px] text-muted">リンクをクリックで切断/復旧。優先度を下げたスイッチがルートになります。</span>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
        <svg viewBox="0 0 540 320" className={clsx("w-full rounded border bg-surface", storming ? "border-err" : "border-line")}>
          {links.map((l) => {
            const a = pos[l.a];
            const b = pos[l.b];
            const roles = r.roles[l.id];
            const blocked = stpOn && (roles.a === "blocked" || roles.b === "blocked");
            const mark = (from: StpBridge, to: StpBridge, role: PortRole) => {
              const t = 0.2;
              const x = from.x + (to.x - from.x) * t;
              const y = from.y + (to.y - from.y) * t;
              const st = ROLE_STYLE[role];
              return (
                <g>
                  <circle cx={x} cy={y} r={11} fill="var(--surface)" stroke={st.color} strokeWidth={1.5} />
                  <text x={x} y={y + 3.5} textAnchor="middle" fontSize="9" fontWeight="700" fill={st.color}>
                    {st.label}
                  </text>
                </g>
              );
            };
            return (
              <g key={l.id} onClick={() => setLinks((ls) => ls.map((x) => (x.id === l.id ? { ...x, up: !x.up } : x)))} className="cursor-pointer">
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={!l.up ? "var(--faint)" : storming ? "var(--err)" : blocked ? "var(--faint)" : "var(--accent)"}
                  strokeWidth={storming ? 4 : 2.5}
                  strokeDasharray={!l.up ? "4 6" : blocked ? "8 5" : undefined}
                  className={storming ? "animate-pulse" : undefined}
                />
                <text x={(a.x + b.x) / 2 + 6} y={(a.y + b.y) / 2 - 6} fontSize="10" fill="var(--muted)">
                  cost {l.cost}
                </text>
                {stpOn && l.up && (
                  <>
                    {mark(a, b, roles.a)}
                    {mark(b, a, roles.b)}
                  </>
                )}
              </g>
            );
          })}
          {bridges.map((b) => (
            <g key={b.id}>
              <rect x={b.x - 48} y={b.y - 20} width={96} height={40} rx={6} fill="var(--surface)" stroke={stpOn && r.root.id === b.id ? "var(--warn)" : "var(--faint)"} strokeWidth={stpOn && r.root.id === b.id ? 3 : 1.5} />
              <text x={b.x} y={b.y - 2} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--fg)">
                {b.id}
                {stpOn && r.root.id === b.id ? " ★" : ""}
              </text>
              <text x={b.x} y={b.y + 12} textAnchor="middle" fontSize="9.5" fill="var(--muted)">
                {b.priority}
              </text>
            </g>
          ))}
        </svg>
        <div className="space-y-3 text-[12.5px]">
          {storming ? (
            <div className="rounded border border-err/50 bg-err/10 p-3 text-err">
              <div className="font-semibold">ブロードキャストストーム発生</div>
              <div className="tnum mt-1 text-[20px] font-semibold">{storm >= 1e9 ? "∞" : storm.toLocaleString()} フレーム/秒</div>
              <div className="mt-1 text-[12px]">ループの中をブロードキャストが回り続けて増殖しています。STP をオンにするか、リンクを切ってループをなくしましょう。</div>
            </div>
          ) : (
            <div className="rounded border border-line p-3">
              <div className="mb-1 font-semibold">{stpOn ? `ルートブリッジ: ${r.root.id} ★` : hasLoop ? "" : "ループなし（STP 不要）"}</div>
              <div className="flex gap-3 text-[11.5px] text-muted">
                <span style={{ color: ROLE_STYLE.root.color }}>RP ルートポート</span>
                <span style={{ color: ROLE_STYLE.designated.color }}>DP 指定ポート</span>
                <span style={{ color: ROLE_STYLE.blocked.color }}>✕ ブロック</span>
              </div>
            </div>
          )}
          <table className="tnum w-full rounded border border-line text-[12px]">
            <thead>
              <tr className="text-muted">
                <th className="border-b border-line px-2 py-1 text-left font-medium">スイッチ</th>
                <th className="border-b border-line px-2 py-1 text-left font-medium">優先度</th>
                <th className="border-b border-line px-2 py-1 text-left font-medium">ルートまで</th>
              </tr>
            </thead>
            <tbody>
              {bridges.map((b) => (
                <tr key={b.id}>
                  <td className="px-2 py-1" title={bridgeIdStr(b)}>
                    {b.id}
                  </td>
                  <td className="px-2 py-1">
                    <select
                      value={b.priority}
                      onChange={(e) => setBridges((bs) => bs.map((x) => (x.id === b.id ? { ...x, priority: Number(e.target.value) } : x)))}
                      className="rounded border border-line bg-surface px-1 py-0.5"
                    >
                      {[4096, 8192, 16384, 24576, 32768, 40960, 61440].map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-1">{r.cost[b.id] === Infinity ? "到達不能" : r.cost[b.id]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11.5px] text-muted">ブリッジ ID = 優先度 + MAC。優先度が同じなら MAC が小さい方が勝ちます（SW-A の MAC が最小）。</p>
        </div>
      </div>
    </div>
  );
}
