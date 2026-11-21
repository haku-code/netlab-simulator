"use client";

import Link from "next/link";
import { useState } from "react";
import { SpeedTest } from "@/components/emulators/SpeedTest";
import { Button, Field, Input, PageHeader, Select, SidePanel, table as t } from "@/components/ui";
import type { QosPriority, QosRule } from "@/lib/model";
import { QOS_LABELS } from "@/lib/net/gateway";
import { useScenario, useStore } from "@/lib/store";

const validLimit = (value?: number) => value === undefined || (Number.isInteger(value) && value >= 1 && value <= 100000);

export default function QosPage() {
  const s = useScenario();
  const mutate = useStore((x) => x.mutate);
  const [draft, setDraft] = useState<QosRule | null>(null);
  const client = s.clients.find((c) => c.id === draft?.clientId);
  const set = (patch: Partial<QosRule>) => setDraft((d) => d && { ...d, ...patch });
  const invalid = !!draft && (!validLimit(draft.downloadLimit) || !validLimit(draft.uploadLimit));
  return (
    <>
      <PageHeader title="QoS" />
      <p className="mb-4 text-[12px] text-muted">
        端末ごとの WAN 優先度と速度上限を設定します。優先度の差を比べるには、
        <Link href="/settings/internet" className="text-accent underline">インターネット設定</Link>で競合フローを増やしてください。
      </p>
      <div className={t.wrap}>
        <table className={t.table}>
          <thead><tr>
            {["端末", "優先度", "下り上限", "上り上限"].map((label) => <th scope="col" key={label} className={t.th}>{label}</th>)}
          </tr></thead>
          <tbody>
            {s.clients.map((c) => {
              const rule = s.qos?.find((q) => q.clientId === c.id);
              return <tr className={t.tr} key={c.id} onClick={() => setDraft(rule ?? { clientId: c.id, priority: "normal" })}>
                <td className={t.td}><button type="button" className="font-medium hover:underline">{c.name}</button></td>
                <td className={t.td}>{QOS_LABELS[rule?.priority ?? "normal"]}</td>
                <td className={t.td}>{rule?.downloadLimit ? `${rule.downloadLimit} Mbps` : "なし"}</td>
                <td className={t.td}>{rule?.uploadLimit ? `${rule.uploadLimit} Mbps` : "なし"}</td>
              </tr>;
            })}
            {!s.clients.length && <tr><td className={`${t.td} text-muted`} colSpan={4}>クライアントがいません。</td></tr>}
          </tbody>
        </table>
      </div>
      {draft && client && (
        <SidePanel open title={`${client.name} の QoS`} onClose={() => setDraft(null)} footer={
          <Button variant="primary" disabled={invalid} onClick={() => {
            mutate((sc) => {
              const rules = (sc.qos ?? []).filter((q) => q.clientId !== draft.clientId);
              sc.qos = draft.priority === "normal" && draft.uploadLimit === undefined && draft.downloadLimit === undefined ? rules : [...rules, draft];
            });
            setDraft(null);
          }}>変更を適用</Button>
        }>
          <Field label="WAN 優先度" hint="競合フローがあるとき、優先度が高い端末へより多くの帯域を配分します。">
            <Select aria-label="WAN 優先度" value={draft.priority} onChange={(v) => set({ priority: v as QosPriority })}
              options={Object.entries(QOS_LABELS).map(([value, label]) => ({ value, label }))} />
          </Field>
          <Field label="下り上限（Mbps）" hint="空欄は上限なし。入力する場合は 1〜100000 の整数。">
            <Input aria-label="下り上限（Mbps）" type="number" min={1} max={100000} value={draft.downloadLimit ?? ""}
              onChange={(e) => set({ downloadLimit: e.target.value === "" ? undefined : Number(e.target.value) })} />
          </Field>
          <Field label="上り上限（Mbps）" hint="空欄は上限なし。入力する場合は 1〜100000 の整数。">
            <Input aria-label="上り上限（Mbps）" type="number" min={1} max={100000} value={draft.uploadLimit ?? ""}
              onChange={(e) => set({ uploadLimit: e.target.value === "" ? undefined : Number(e.target.value) })} />
          </Field>
          <section className="space-y-2 border-t border-line pt-3">
            <h3 className="font-semibold">保存済みの設定で測定</h3>
            <SpeedTest key={client.id} clientId={client.id} />
          </section>
        </SidePanel>
      )}
    </>
  );
}
