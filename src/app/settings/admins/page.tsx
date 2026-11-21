"use client";

import clsx from "clsx";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Checkbox, Field, Input, PageHeader, Segmented, SidePanel, table as t } from "@/components/ui";
import { ROLE_HINT, ROLE_LABEL, useCanManage, useOps, type Admin, type AdminRole } from "@/lib/ops/store";

export default function AdminsPage() {
  const ops = useOps();
  const canManage = useCanManage();
  const [edit, setEdit] = useState<string | null>(null);
  const siteName = (id: string) => ops.sites.find((x) => x.id === id)?.name ?? id;
  return (
    <>
      <PageHeader title="管理者とロール" count={ops.admins.length}>
        <Button variant="primary" disabled={!canManage} onClick={() => setEdit("new")}>
          <Plus size={14} /> 管理者を追加
        </Button>
      </PageHeader>
      <p className="mb-4 max-w-3xl text-[12.5px] text-fg-2">
        管理者ごとにロールと担当サイトを決めます。ヘッダー右上のアイコンから、ログイン中の管理者を切り替えて権限の違いを試せます（課題中は誰でも構成を変更できます）。
      </p>
      <div className="mb-4 grid max-w-3xl gap-2 sm:grid-cols-3">
        {(Object.keys(ROLE_LABEL) as AdminRole[]).map((r) => (
          <div key={r} className="rounded border border-line bg-surface px-3 py-2">
            <div className="font-medium">{ROLE_LABEL[r]}</div>
            <div className="text-[11.5px] text-muted">{ROLE_HINT[r]}</div>
          </div>
        ))}
      </div>
      <div className={t.wrap}>
        <table className={t.table}>
          <thead>
            <tr>
              <th className={t.th}>名前</th>
              <th className={t.th}>ロール</th>
              <th className={t.th}>担当サイト</th>
              <th className={t.th} />
            </tr>
          </thead>
          <tbody>
            {ops.admins.map((a) => (
              <tr key={a.id} className={clsx(t.tr, !canManage && "cursor-default")} onClick={() => canManage && setEdit(a.id)}>
                <td className={t.td}>
                  <span className="inline-flex items-center gap-2 font-medium">
                    {a.name}
                    {a.id === ops.currentAdminId && <Badge tone="accent">ログイン中</Badge>}
                  </span>
                </td>
                <td className={t.td}>{ROLE_LABEL[a.role]}</td>
                <td className={clsx(t.td, "text-fg-2")}>{a.role === "super" || !a.siteIds ? "すべてのサイト" : a.siteIds.map(siteName).join("、") || "なし"}</td>
                <td className={clsx(t.td, "text-right")}>
                  {a.id !== ops.currentAdminId && (
                    <Button
                      className="h-7"
                      onClick={(e) => {
                        e.stopPropagation();
                        ops.loginAs(a.id);
                      }}
                    >
                      この管理者でログイン
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <AdminPanel key={edit} id={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function AdminPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const ops = useOps();
  const isNew = id === "new";
  const existing = ops.admins.find((a) => a.id === id);
  const [draft, setDraft] = useState<Admin>(() => existing ?? { id: `admin-${Date.now().toString(36)}`, name: "", role: "viewer" });
  const name = draft.name.trim();
  const conflict = ops.admins.some((a) => a.id !== draft.id && a.name.trim() === name);
  const lastSuper = existing?.role === "super" && ops.admins.filter((a) => a.role === "super").length <= 1;
  const scoped = draft.role !== "super";
  return (
    <SidePanel
      open
      onClose={onClose}
      title={isNew ? "管理者を追加" : (existing?.name ?? "")}
      footer={
        <>
          <Button
            variant="primary"
            disabled={!name || conflict || (lastSuper && draft.role !== "super")}
            onClick={() => {
              ops.saveAdmin({ ...draft, name, siteIds: scoped ? draft.siteIds : undefined });
              onClose();
            }}
          >
            {isNew ? "管理者を追加" : "変更を適用"}
          </Button>
          {!isNew && (
            <Button
              variant="danger"
              disabled={id === ops.currentAdminId || lastSuper}
              onClick={() => {
                if (!confirm(`管理者「${existing?.name}」を削除しますか？`)) return;
                ops.removeAdmin(id);
                onClose();
              }}
            >
              削除
            </Button>
          )}
        </>
      }
    >
      <Field label="名前" error={conflict ? "同じ名前の管理者がいます。" : undefined}>
        <Input aria-label="管理者名" value={draft.name} placeholder="例: 店長" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </Field>
      <Field label="ロール" hint={lastSuper && draft.role !== "super" ? "スーパー管理者は最低 1 人必要です。" : ROLE_HINT[draft.role]}>
        <Segmented<AdminRole>
          value={draft.role}
          onChange={(role) => setDraft({ ...draft, role })}
          options={(Object.keys(ROLE_LABEL) as AdminRole[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
        />
      </Field>
      {scoped && (
        <Field label="担当サイト" hint="選ばないとすべてのサイトを扱えます。">
          <div className="rounded border border-line px-3 py-1.5">
            {ops.sites.map((site) => (
              <Checkbox
                key={site.id}
                checked={!!draft.siteIds?.includes(site.id)}
                label={site.name}
                onChange={(v) => {
                  const next = v ? [...(draft.siteIds ?? []), site.id] : (draft.siteIds ?? []).filter((x) => x !== site.id);
                  setDraft({ ...draft, siteIds: next.length ? next : undefined });
                }}
              />
            ))}
          </div>
        </Field>
      )}
    </SidePanel>
  );
}
