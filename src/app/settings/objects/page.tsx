"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { Button, Checkbox, Field, Input, PageHeader, Select, SidePanel, table as t, useDraft } from "@/components/ui";
import { uid, type PolicyObject } from "@/lib/model";
import { ipToStr, parseCidr, parseIp, subnetToStr } from "@/lib/net/ip";
import { GROUP_REF } from "@/lib/net/simulate";
import { useStore } from "@/lib/store";

const KINDS = { devices: "端末グループ", ips: "IP グループ", ports: "ポートリスト" } satisfies Record<PolicyObject["kind"], string>;

export default function ObjectsPage() {
  const s = useStore((x) => x.scenario);
  const [edit, setEdit] = useState<string | null>(null);
  const objects = s.objects ?? [];
  return (
    <>
      <PageHeader title="オブジェクト" count={objects.length}>
        <Button variant="primary" onClick={() => setEdit("new")}><Plus size={14} /> オブジェクトを作成</Button>
      </PageHeader>
      <div className={t.wrap}>
        <table className={t.table}>
          <thead>
            <tr><th className={t.th}>名前</th><th className={t.th}>種類</th><th className={t.th}>メンバー</th></tr>
          </thead>
          <tbody>
            {objects.map((object) => (
              <tr className={t.tr} key={object.id} onClick={() => setEdit(object.id)}>
                <td className={t.td}><button type="button" className="font-medium hover:underline">{object.name}</button></td>
                <td className={t.td}>{KINDS[object.kind]}</td>
                <td className={`${t.td} whitespace-normal py-2 break-all`}>
                  {object.values.map((v) => object.kind === "devices" ? s.clients.find((c) => c.id === v)?.name ?? "削除済みの端末" : v).join("、") || "—"}
                </td>
              </tr>
            ))}
            {!objects.length && <tr><td className={`${t.td} text-muted`} colSpan={3}>オブジェクトはまだありません。</td></tr>}
          </tbody>
        </table>
      </div>
      {edit && <ObjectPanel key={edit} id={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function ObjectPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const s = useStore((x) => x.scenario);
  const mutate = useStore((x) => x.mutate);
  const isNew = id === "new";
  const existing = s.objects?.find((o) => o.id === id);
  const [blank] = useState<PolicyObject>(() => ({ id: uid("obj"), kind: "devices", name: "", values: [] }));
  const { draft, update, dirty, reset } = useDraft(isNew ? blank : existing, id);
  const [entries, setEntries] = useState(existing?.kind === "devices" ? "" : existing?.values.join("\n") ?? "");
  const originalEntries = existing?.kind === "devices" ? "" : existing?.values.join("\n") ?? "";
  if (!draft) return null;

  const ref = `${GROUP_REF}${id}`;
  const referenced = s.policies.some((p) => p.src === ref || p.dst === ref || p.portListId === id);
  const name = draft.name.trim();
  const nameConflict = s.objects?.some((o) => o.id !== draft.id && o.name.trim() === name);
  const tokens = entries.split(/[\s,、]+/).filter(Boolean);
  const parsed = tokens.map((token) => {
    if (draft.kind === "ports") return /^\d+$/.test(token) && Number(token) >= 1 && Number(token) <= 65535 ? String(Number(token)) : null;
    const cidr = parseCidr(token);
    const ip = parseIp(token);
    return cidr ? subnetToStr(cidr) : ip === null ? null : ipToStr(ip);
  });
  const values = draft.kind === "devices"
    ? draft.values.filter((v) => s.clients.some((c) => c.id === v))
    : parsed.filter((v) => v !== null);
  const invalid = draft.kind !== "devices" ? tokens.filter((_, i) => parsed[i] === null) : [];
  const changed = dirty || entries !== originalEntries;

  const save = () => {
    mutate((sc) => {
      const objects = (sc.objects ??= []);
      const next = { ...draft, name, values: [...new Set(values)] };
      const index = objects.findIndex((o) => o.id === draft.id);
      if (index === -1) objects.push(next);
      else objects[index] = next;
    });
    onClose();
  };

  return (
    <SidePanel open onClose={onClose} title={isNew ? "オブジェクトを作成" : existing?.name ?? draft.name} footer={
      <>
        <Button variant="primary" onClick={save} disabled={!name || !!nameConflict || !values.length || !!invalid.length || (!isNew && !changed)}>
          {isNew ? "オブジェクトを追加" : "変更を適用"}
        </Button>
        {!isNew && <Button disabled={!changed} onClick={() => { reset(); setEntries(originalEntries); }}>元に戻す</Button>}
      </>
    }>
      <Field label="名前" error={nameConflict ? "同じ名前のオブジェクトがあります。" : undefined}>
        <Input aria-label="オブジェクト名" value={draft.name} onChange={(e) => update((o) => (o.name = e.target.value))} />
      </Field>
      <Field label="種類" hint={referenced ? "ポリシーで使用中のため、種類は変更できません。" : undefined}>
        <Select aria-label="オブジェクトの種類" value={draft.kind} disabled={referenced} onChange={(v) => {
          update((o) => { o.kind = v as PolicyObject["kind"]; o.values = []; });
          setEntries("");
        }} options={Object.entries(KINDS).map(([value, label]) => ({ value, label }))} />
      </Field>
      {draft.kind === "devices" ? (
        <Field label="端末" hint="ポリシーの対象にする端末を選びます。">
          <div className="max-h-60 overflow-y-auto rounded border border-line px-3 py-1.5">
            {s.clients.map((c) => <Checkbox key={c.id} checked={draft.values.includes(c.id)} label={c.name}
              onChange={(on) => update((o) => (o.values = on ? [...o.values, c.id] : o.values.filter((v) => v !== c.id)))} />)}
            {!s.clients.length && <p className="p-1.5 text-muted">選択できる端末がありません。</p>}
          </div>
        </Field>
      ) : (
        <Field label={draft.kind === "ips" ? "IPv4 / CIDR" : "ポート番号"}
          hint={draft.kind === "ips" ? "例 192.168.1.20、192.168.30.0/24。改行またはカンマ区切り。" : "1〜65535 の整数を、改行またはカンマで区切ります。"}
          error={invalid.length ? `無効な値があります（${invalid.join("、")}）。` : undefined}
        >
          <textarea aria-label={draft.kind === "ips" ? "IPv4 / CIDR" : "ポート番号"} aria-invalid={!!invalid.length}
            rows={5} value={entries} onChange={(e) => setEntries(e.target.value)}
            className="tnum w-full rounded border border-line bg-surface px-2.5 py-2 outline-none focus:border-accent" />
        </Field>
      )}
    </SidePanel>
  );
}
