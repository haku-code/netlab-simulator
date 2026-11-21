"use client";

import { Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button, Checkbox, Field, Input, SidePanel, table as t } from "./ui";

type Entry = { id: string; name: string; enabled: boolean };

export function GatewayRules<T extends Entry>({ title, entries, create, save, remove, columns, row, fields, error }: {
  title: string;
  entries: readonly T[];
  create: () => T;
  save: (entry: T) => void;
  remove: (id: string) => void;
  columns: string[];
  row: (entry: T) => ReactNode[];
  fields: (entry: T, update: (values: Partial<T>) => void) => ReactNode;
  error: (entry: T) => string | null;
}) {
  const [draft, setDraft] = useState<T | null>(null);
  const existing = entries.find((e) => e.id === draft?.id);
  const update = (values: Partial<T>) => setDraft((d) => d && { ...d, ...values });
  const invalid = draft ? error(draft) : null;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        <Button variant="primary" onClick={() => setDraft(create())}><Plus size={14} /> {title}を追加</Button>
      </div>
      <div className={t.wrap}>
        <table className={t.table}>
          <thead><tr>
            {["名前", ...columns, "状態"].map((col) => <th scope="col" className={t.th} key={col}>{col}</th>)}
          </tr></thead>
          <tbody>
            {entries.map((entry) => <tr key={entry.id} className={t.tr} onClick={() => setDraft(entry)}>
              <td className={t.td}><button type="button" className="font-medium hover:underline">{entry.name}</button></td>
              {row(entry).map((value, i) => <td className={t.td} key={i}>{value}</td>)}
              <td className={t.td}>{entry.enabled ? "有効" : "無効"}</td>
            </tr>)}
            {!entries.length && <tr><td className={`${t.td} text-muted`} colSpan={columns.length + 2}>設定されていません。</td></tr>}
          </tbody>
        </table>
      </div>
      {draft && <SidePanel open onClose={() => setDraft(null)} title={existing ? `${title}を編集` : `${title}を追加`} footer={
        <>
          <Button variant="primary" disabled={!draft.name.trim() || !!invalid} onClick={() => {
            save({ ...draft, name: draft.name.trim() });
            setDraft(null);
          }}>変更を適用</Button>
          {!!existing && <Button variant="danger" className="ml-auto" onClick={() => {
            remove(existing.id);
            setDraft(null);
          }}>削除</Button>}
        </>
      }>
        <Field label="名前">
          <Input aria-label={`${title}の名前`} value={draft.name} onChange={(e) => update({ name: e.target.value } as Partial<T>)} />
        </Field>
        {fields(draft, update)}
        <Checkbox label="有効" checked={draft.enabled} onChange={(enabled) => update({ enabled } as Partial<T>)} />
        {invalid && <p className="text-[12px] text-err">{invalid}</p>}
      </SidePanel>}
    </section>
  );
}
