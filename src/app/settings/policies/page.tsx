"use client";

import clsx from "clsx";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Field, Input, Notice, PageHeader, Segmented, Select, SidePanel, Term, Toggle, table as t, useDraft } from "@/components/ui";
import { useIssues } from "@/lib/hooks";
import { uid, type FirewallPolicy, type Scenario } from "@/lib/model";
import { CLIENT_REF, GROUP_REF, clientNetworkId, clientRef, findNetwork, findObject, isClientRef, isGroupRef, zoneDefault, zoneName } from "@/lib/net/simulate";
import { ClockControl, DAYS, scheduleLabel } from "@/components/ClockControl";
import { useStore } from "@/lib/store";

const PROTO = [
  { value: "all", label: "すべて" },
  { value: "tcp", label: "TCP" },
  { value: "udp", label: "UDP" },
  { value: "icmp", label: "ICMP" },
];

function refLabel(s: Scenario, ref: string) {
  if (ref === "any") return "指定なし";
  if (isClientRef(ref)) return s.clients.find((c) => c.id === ref.slice(CLIENT_REF.length))?.name ?? "(削除済みの端末)";
  if (isGroupRef(ref)) return findObject(s, ref)?.name ?? "(削除済みのグループ)";
  return findNetwork(s, ref)?.name ?? "(削除済み)";
}

function endpoint(s: Scenario, zone: string, ref: string) {
  return (
    <>
      <span className="font-medium">{zoneName(s, zone)}</span>
      <span className="text-muted"> · </span>
      {isClientRef(ref) && <span className="mr-1 rounded bg-surface-2 px-1 text-[10.5px] text-muted ring-1 ring-line">端末</span>}
      <span className="text-muted">{refLabel(s, ref)}</span>
    </>
  );
}

export default function PoliciesPage() {
  const s = useStore((x) => x.scenario);
  const mutate = useStore((x) => x.mutate);
  const issues = useIssues().filter((i) => i.area === "firewall");
  const [pair, setPair] = useState<{ src: string; dst: string } | null>(null);
  const [edit, setEdit] = useState<string | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("src") && p.get("dst")) setPair({ src: p.get("src")!, dst: p.get("dst")! });
  }, []);

  const clearPair = () => {
    setPair(null);
    window.history.replaceState(null, "", "/settings/policies");
  };

  const move = (i: number, d: -1 | 1) =>
    mutate((sc) => {
      const j = i + d;
      if (j < 0 || j >= sc.policies.length) return;
      [sc.policies[i], sc.policies[j]] = [sc.policies[j], sc.policies[i]];
    });

  const rows = s.policies.map((p, i) => ({ p, i })).filter(({ p }) => !pair || (p.srcZone === pair.src && p.dstZone === pair.dst));

  return (
    <>
      <PageHeader title="ポリシー一覧" count={s.policies.length}>
        <ClockControl />
        <Button variant="primary" onClick={() => setEdit("new")}>
          <Plus size={14} /> ポリシーを作成
        </Button>
      </PageHeader>
      <div className="mb-3 flex items-center gap-2 text-[12px] text-muted">
        {pair ? (
          <span className="inline-flex h-7 items-center gap-2 rounded border border-line bg-surface pr-1 pl-2.5 text-fg">
            {zoneName(s, pair.src)} → {zoneName(s, pair.dst)}
            <button onClick={clearPair} className="rounded p-0.5 text-muted hover:bg-hover hover:text-fg" aria-label="フィルター解除">
              <X size={13} />
            </button>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1">
            ポリシーは上から順に評価され、最初に一致したものが適用されます <Term id="rule-order" />
          </span>
        )}
      </div>
      <Notice issues={issues} />
      <div className={t.wrap}>
        <table className={t.table}>
          <thead>
            <tr>
              <th className={clsx(t.th, "w-16")}>#</th>
              <th className={t.th}>名前</th>
              <th className={t.th}>動作</th>
              <th className={t.th}>送信元</th>
              <th className={t.th}>宛先</th>
              <th className={t.th}>プロトコル</th>
              <th className={t.th}>有効</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, i }) => {
              const warn = issues.some((x) => x.targetId === p.id);
              return (
                <tr key={p.id} className={clsx(t.tr, !p.enabled && "opacity-50")} onClick={() => setEdit(p.id)}>
                  <td className={t.td} onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1.5">
                      <span className="tnum w-4 text-muted">{i + 1}</span>
                      <div className="flex flex-col">
                        <button className="text-muted hover:text-fg disabled:opacity-25" disabled={i === 0} onClick={() => move(i, -1)} aria-label="上へ">
                          <ArrowUp size={12} />
                        </button>
                        <button className="text-muted hover:text-fg disabled:opacity-25" disabled={i === s.policies.length - 1} onClick={() => move(i, 1)} aria-label="下へ">
                          <ArrowDown size={12} />
                        </button>
                      </div>
                    </div>
                  </td>
                  <td className={t.td}>
                    <span className="font-medium">{p.name}</span>
                    {warn && <span className="ml-2 text-[12px] text-warn">評価されません</span>}
                    {p.schedule && <span className="ml-2 rounded bg-surface-2 px-1 text-[11px] text-muted ring-1 ring-line">{scheduleLabel(p.schedule)}</span>}
                    {(p.connState ?? "all") !== "all" && <span className="ml-2 rounded bg-surface-2 px-1 text-[11px] text-muted ring-1 ring-line">{p.connState === "new" ? "新規のみ" : "戻りのみ"}</span>}
                  </td>
                  <td className={t.td}>
                    <span className={clsx("font-medium", p.action === "allow" ? "text-ok" : "text-err")}>{p.action === "allow" ? "許可" : "拒否"}</span>
                  </td>
                  <td className={t.td}>{endpoint(s, p.srcZone, p.src)}</td>
                  <td className={t.td}>{endpoint(s, p.dstZone, p.dst)}</td>
                  <td className={clsx(t.td, "text-fg-2")}>
                    {p.protocol === "all" ? "すべて" : p.protocol.toUpperCase()}
                    {p.portListId ? ` / ${s.objects?.find((o) => o.id === p.portListId)?.name ?? "?"}` : p.port !== null && ` / ${p.port}`}
                  </td>
                  <td className={t.td} onClick={(e) => e.stopPropagation()}>
                    <Toggle checked={p.enabled} onChange={(v) => mutate((sc) => (sc.policies[i].enabled = v))} />
                  </td>
                </tr>
              );
            })}
            <tr className="text-muted">
              <td className={t.td}>—</td>
              <td className={t.td} colSpan={6}>
                {pair
                  ? `一致しない通信はゾーンの既定動作: ${zoneDefault(pair.src, pair.dst) === "allow" ? "すべて許可" : "すべて拒否"}`
                  : "一致しない通信はゾーンマトリクスの既定動作 (すべて許可 / すべて拒否) で処理されます"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {edit && <PolicyPanel id={edit} preset={pair} onClose={() => setEdit(null)} />}
    </>
  );
}

function PolicyPanel({ id, preset, onClose }: { id: string; preset: { src: string; dst: string } | null; onClose: () => void }) {
  const s = useStore((x) => x.scenario);
  const mutate = useStore((x) => x.mutate);
  const isNew = id === "new";
  const blank: FirewallPolicy = {
    id: uid("pol"),
    name: "",
    action: "block",
    srcZone: preset?.src ?? "internal",
    src: "any",
    dstZone: preset?.dst ?? "internal",
    dst: "any",
    protocol: "all",
    port: null,
    enabled: true,
  };
  const { draft, update, dirty } = useDraft<FirewallPolicy>(isNew ? blank : s.policies.find((p) => p.id === id), id);
  const issues = useIssues().filter((i) => i.targetId === id);
  if (!draft) return null;

  const zoneOpts = (exclude: string[]) => s.zones.filter((z) => !exclude.includes(z.id)).map((z) => ({ value: z.id, label: z.name }));
  // UniFi の「Specific Source / Destination」: ネットワーク単位か端末単位を選べる
  const netOpts = (zone: string) => {
    const nets = s.networks.filter((n) => n.zoneId === zone);
    const devices = s.clients.filter((c) => {
      const id = clientNetworkId(s, c);
      return id && nets.some((n) => n.id === id);
    });
    return [
      { value: "any", label: "指定なし" },
      ...nets.map((n) => ({ value: n.id, label: `ネットワーク: ${n.name}` })),
      ...devices.map((c) => ({ value: clientRef(c.id), label: `端末: ${c.name}` })),
      ...(s.objects ?? []).filter((o) => o.kind !== "ports").map((o) => ({ value: `${GROUP_REF}${o.id}`, label: `グループ: ${o.name}` })),
    ];
  };
  const invalidSchedule = !!draft.schedule && (!draft.schedule.days.length || !draft.schedule.start || !draft.schedule.end);

  const apply = () => {
    mutate((sc) => {
      const p = { ...draft, name: draft.name.trim() || "新しいポリシー" };
      const i = sc.policies.findIndex((x) => x.id === p.id);
      if (i >= 0) sc.policies[i] = p;
      else sc.policies.push(p);
    });
    onClose();
  };

  return (
    <SidePanel
      open
      onClose={onClose}
      title={isNew ? "ポリシーを作成" : draft.name}
      footer={
        <>
          <Button variant="primary" disabled={(!isNew && !dirty) || invalidSchedule} onClick={apply}>
            {isNew ? "ポリシーを追加" : "変更を適用"}
          </Button>
          {!isNew && (
            <Button
              variant="danger"
              className="ml-auto"
              onClick={() => {
                mutate((sc) => {
                  sc.policies = sc.policies.filter((p) => p.id !== id);
                });
                onClose();
              }}
            >
              削除
            </Button>
          )}
        </>
      }
    >
      {issues.map((i, k) => (
        <div key={k} className="rounded border border-warn/40 bg-warn/5 px-3 py-2 text-[12.5px]">
          {i.message}
        </div>
      ))}
      <Field label="名前">
        <Input aria-label="ポリシー名" value={draft.name} placeholder="例: IoT から LAN への通信を拒否" onChange={(e) => update((p) => (p.name = e.target.value))} />
      </Field>
      <Field label="動作" term="policy">
        <Segmented<FirewallPolicy["action"]>
          value={draft.action}
          onChange={(v) => update((p) => (p.action = v))}
          options={[
            { value: "allow", label: "許可" },
            { value: "block", label: "拒否" },
          ]}
        />
      </Field>
      <div className="rounded border border-line p-3">
        <div className="mb-2 text-[12px] font-medium">送信元</div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="ゾーン">
            <Select aria-label="送信元ゾーン" value={draft.srcZone} onChange={(v) => update((p) => ((p.srcZone = v), (p.src = "any")))} options={zoneOpts([])} />
          </Field>
          <Field label="ネットワーク / 端末 / グループ">
            <Select aria-label="送信元の対象" value={draft.src} onChange={(v) => update((p) => (p.src = v))} options={netOpts(draft.srcZone)} />
          </Field>
        </div>
      </div>
      <div className="rounded border border-line p-3">
        <div className="mb-2 text-[12px] font-medium">宛先</div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="ゾーン">
            <Select aria-label="宛先ゾーン" value={draft.dstZone} onChange={(v) => update((p) => ((p.dstZone = v), (p.dst = "any")))} options={zoneOpts([])} />
          </Field>
          <Field label="ネットワーク / 端末 / グループ">
            <Select aria-label="宛先の対象" value={draft.dst} disabled={draft.dstZone === "external" || draft.dstZone === "gateway"} onChange={(v) => update((p) => (p.dst = v))} options={netOpts(draft.dstZone)} />
          </Field>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="プロトコル">
          <Select aria-label="ポリシーのプロトコル" value={draft.protocol} onChange={(v) => update((p) => {
            p.protocol = v as FirewallPolicy["protocol"];
            if (v === "icmp") { p.port = null; p.portListId = undefined; }
          })} options={PROTO} />
        </Field>
        <Field label="ポート" hint="空欄のままならすべてのポートが対象">
          <div className="flex gap-1.5">
            <Select
              aria-label="ポートの指定方法"
              className="w-28 shrink-0"
              disabled={draft.protocol === "icmp"}
              value={draft.portListId ? `list:${draft.portListId}` : "num"}
              onChange={(v) => update((p) => (p.portListId = v.startsWith("list:") ? v.slice(5) : undefined))}
              options={[{ value: "num", label: "番号" }, ...(s.objects ?? []).filter((o) => o.kind === "ports").map((o) => ({ value: `list:${o.id}`, label: o.name }))]}
            />
            {!draft.portListId && (
              <Input
                type="number"
                min={1}
                max={65535}
                className="tnum"
                disabled={draft.protocol === "icmp"}
                value={draft.port ?? ""}
                onChange={(e) => update((p) => (p.port = e.target.value === "" ? null : Number(e.target.value)))}
              />
            )}
          </div>
        </Field>
      </div>
      <Field label="接続状態" term="stateful" hint="拒否ポリシーを「すべて」にすると、反対側から始めた通信の戻り（応答）まで止まります。">
        <Select
          aria-label="接続状態"
          value={draft.connState ?? "all"}
          onChange={(v) => update((p) => (p.connState = v as FirewallPolicy["connState"]))}
          options={[
            { value: "all", label: "すべて（新規 + 戻り）" },
            { value: "new", label: "新規の接続のみ" },
            { value: "established", label: "確立済み（戻りの通信）のみ" },
          ]}
        />
      </Field>
      <Field label="スケジュール" hint="ポリシー一覧やパケットトレースで、シミュレーション時刻を変更できます。"
        error={invalidSchedule ? "曜日を1つ以上選び、開始・終了時刻を入力してください。" : undefined}>
        <Segmented<"always" | "custom">
          value={draft.schedule ? "custom" : "always"}
          onChange={(v) => update((p) => (p.schedule = v === "always" ? undefined : { days: [0, 1, 2, 3, 4, 5, 6], start: "22:00", end: "06:00" }))}
          options={[
            { value: "always", label: "常時" },
            { value: "custom", label: "指定する" },
          ]}
        />
        {draft.schedule && (
          <div className="mt-2 space-y-2 rounded border border-line p-2.5">
            <div className="flex gap-1">
              {DAYS.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={draft.schedule!.days.includes(i)}
                  onClick={() => update((p) => (p.schedule!.days = p.schedule!.days.includes(i) ? p.schedule!.days.filter((x) => x !== i) : [...p.schedule!.days, i].sort()))}
                  className={clsx("size-7 rounded text-[12px]", draft.schedule!.days.includes(i) ? "bg-accent text-white" : "bg-surface-2 text-muted hover:text-fg")}
                >
                  {d}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Input aria-label="開始時刻" type="time" className="tnum w-32" value={draft.schedule.start} onInput={(e) => {
                const time = e.currentTarget.value;
                update((p) => (p.schedule!.start = time));
              }} />
              <span className="text-muted">〜</span>
              <Input aria-label="終了時刻" type="time" className="tnum w-32" value={draft.schedule.end} onInput={(e) => {
                const time = e.currentTarget.value;
                update((p) => (p.schedule!.end = time));
              }} />
            </div>
          </div>
        )}
      </Field>
      <div className="flex items-center justify-between">
        <span>有効</span>
        <Toggle checked={draft.enabled} onChange={(v) => update((p) => (p.enabled = v))} />
      </div>
    </SidePanel>
  );
}
