"use client";

import clsx from "clsx";
import { Archive, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, Button, PageHeader, SearchInput, Segmented, Tabs, Toggle, table as t } from "@/components/ui";
import { CATEGORY_LABEL, SEVERITY_LABEL, type EventCategory, type EventSeverity, type OpsEvent } from "@/lib/ops/events";
import { isAlarm, useSiteEvents } from "@/components/ops";
import { useCanManage, useOps } from "@/lib/ops/store";
import { useStore } from "@/lib/store";

type Tab = "log" | "alarms" | "rules";

const fmt = (ms: number) =>
  new Date(ms).toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });

function SeverityDot({ severity }: { severity: EventSeverity }) {
  return <span className={clsx("size-2 shrink-0 rounded-full", severity === "critical" ? "bg-err" : severity === "warning" ? "bg-warn" : "bg-accent")} />;
}

function targetHref(s: ReturnType<typeof useStore.getState>["scenario"], id?: string) {
  if (!id) return null;
  if (s.devices.some((d) => d.id === id)) return `/devices?id=${id}`;
  if (s.clients.some((c) => c.id === id)) return `/clients?id=${id}`;
  return null;
}

export default function LogsPage() {
  const [tab, setTab] = useState<Tab>("log");
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("tab");
    if (p === "alarms" || p === "rules") setTab(p);
  }, []);
  const events = useSiteEvents();
  const rules = useOps((x) => x.alarmRules);
  const open = events.filter((e) => isAlarm(e, rules) && !e.archived).length;

  return (
    <>
      <PageHeader title="ログ" />
      <div className="mb-4">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "log", label: "システムログ" },
            { value: "alarms", label: open ? `アラーム (${open})` : "アラーム" },
            { value: "rules", label: "アラームの設定" },
          ]}
        />
      </div>
      {tab === "log" && <SystemLog events={events} />}
      {tab === "alarms" && <Alarms events={events} />}
      {tab === "rules" && <AlarmRules />}
    </>
  );
}

function SystemLog({ events }: { events: OpsEvent[] }) {
  const s = useStore((x) => x.scenario);
  const clear = useOps((x) => x.clearEvents);
  const canManage = useCanManage();
  const [cat, setCat] = useState<"all" | EventCategory>("all");
  const [q, setQ] = useState("");
  const rows = events.filter((e) => (cat === "all" || e.category === cat) && e.message.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented<"all" | EventCategory>
          size="sm"
          value={cat}
          onChange={setCat}
          options={[{ value: "all", label: "すべて" }, ...(Object.keys(CATEGORY_LABEL) as EventCategory[]).map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))]}
        />
        <SearchInput value={q} onChange={setQ} />
        <div className="ml-auto">
          <Button disabled={!events.length || !canManage} onClick={() => confirm("このサイトのログをすべて消去しますか？") && clear()}>
            <Trash2 size={14} /> ログを消去
          </Button>
        </div>
      </div>
      <div className={t.wrap}>
        <table className={t.table}>
          <thead>
            <tr>
              <th className={t.th}>日時</th>
              <th className={t.th}>重要度</th>
              <th className={t.th}>種類</th>
              <th className={t.th}>内容</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const href = targetHref(s, e.targetId);
              return (
                <tr key={e.id} className={t.tr}>
                  <td className={clsx(t.td, "tnum text-fg-2")}>{fmt(e.time)}</td>
                  <td className={t.td}>
                    <span className="inline-flex items-center gap-1.5">
                      <SeverityDot severity={e.severity} />
                      {SEVERITY_LABEL[e.severity]}
                    </span>
                  </td>
                  <td className={clsx(t.td, "text-fg-2")}>{CATEGORY_LABEL[e.category]}</td>
                  <td className={clsx(t.td, "py-2 whitespace-normal")}>
                    {href ? (
                      <Link href={href} className="hover:underline">
                        {e.message}
                      </Link>
                    ) : (
                      e.message
                    )}
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td className={clsx(t.td, "text-muted")} colSpan={4}>
                  {events.length ? "条件に合うイベントはありません。" : "まだイベントはありません。ケーブルを抜く、ポリシーを追加するなど構成を変えると記録されます。"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Alarms({ events }: { events: OpsEvent[] }) {
  const rules = useOps((x) => x.alarmRules);
  const archive = useOps((x) => x.archive);
  const archiveAll = useOps((x) => x.archiveAll);
  const [showArchived, setShowArchived] = useState(false);
  const alarms = events.filter((e) => isAlarm(e, rules) && (showArchived || !e.archived));
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-fg-2">
          <Toggle checked={showArchived} onChange={setShowArchived} /> アーカイブ済みも表示
        </label>
        <div className="ml-auto">
          <Button disabled={!alarms.some((a) => !a.archived)} onClick={archiveAll}>
            <Archive size={14} /> すべてアーカイブ
          </Button>
        </div>
      </div>
      <ul className="divide-y divide-line-soft rounded-lg border border-line bg-surface">
        {alarms.map((e) => (
          <li key={e.id} className={clsx("flex items-start gap-3 px-4 py-3", e.archived && "opacity-55")}>
            <span className="mt-1.5">
              <SeverityDot severity={e.severity} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="whitespace-normal">{e.message}</div>
              <div className="mt-0.5 text-[11.5px] text-muted">
                <span className="tnum">{fmt(e.time)}</span> · {CATEGORY_LABEL[e.category]} · {SEVERITY_LABEL[e.severity]}
              </div>
            </div>
            {e.archived ? (
              <Badge>アーカイブ済み</Badge>
            ) : (
              <Button className="h-7" onClick={() => archive(e.id)}>
                アーカイブ
              </Button>
            )}
          </li>
        ))}
        {!alarms.length && <li className="px-4 py-6 text-center text-muted">未対応のアラームはありません。</li>}
      </ul>
    </>
  );
}

function AlarmRules() {
  const rules = useOps((x) => x.alarmRules);
  const setRule = useOps((x) => x.setAlarmRule);
  const desc: Record<EventCategory, string> = {
    device: "デバイスのオフライン・削除",
    client: "有線クライアントの切断",
    wifi: "Wi-Fi クライアントの切断",
    security: "ファイアウォールによるブロック",
    switching: "ループ・STP のブロック・PoE 給電の停止",
    system: "構成の大きな変化",
    admin: "管理者の操作（削除・復元・拒否された変更）",
  };
  return (
    <div className="max-w-2xl">
      <p className="mb-3 text-[12.5px] text-fg-2">警告・重大のイベントのうち、オンにした種類をアラームとして通知します。すべてのイベントはシステムログに残ります。</p>
      <ul className="divide-y divide-line-soft rounded-lg border border-line bg-surface">
        {(Object.keys(CATEGORY_LABEL) as EventCategory[]).map((c) => (
          <li key={c} className="flex items-center gap-3 px-4 py-2.5">
            <div className="flex-1">
              <div className="font-medium">{CATEGORY_LABEL[c]}</div>
              <div className="text-[11.5px] text-muted">{desc[c]}</div>
            </div>
            <Toggle checked={rules[c]} onChange={(v) => setRule(c, v)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

