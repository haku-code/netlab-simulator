"use client";

import clsx from "clsx";
import { Plus } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Field, Input, PageHeader, Segmented, SidePanel, table as t } from "@/components/ui";
import { siteAllowed, useCanManage, useOps, type Site } from "@/lib/ops/store";
import { useStore } from "@/lib/store";

export default function SitesPage() {
  const ops = useOps();
  const lesson = useStore((x) => x.activeLessonId);
  const scenario = useStore((x) => x.scenario);
  const canManage = useCanManage();
  const [edit, setEdit] = useState<string | null>(null);
  const summary = (site: Site) => {
    const s = site.id === ops.activeSiteId ? (lesson ? useStore.getState().sandboxBackup : scenario) : site.scenario;
    return s ? `${s.devices.length} 台 · ${s.clients.length} クライアント · ${s.networks.length} ネットワーク` : "初期構成";
  };
  return (
    <>
      <PageHeader title="サイト" count={ops.sites.length}>
        <Button variant="primary" disabled={!canManage} onClick={() => setEdit("new")}>
          <Plus size={14} /> サイトを作成
        </Button>
      </PageHeader>
      <p className="mb-4 max-w-3xl text-[12.5px] text-fg-2">
        自宅・店舗・事務所など、拠点ごとに別々の構成を管理します。ヘッダーのサイト名から切り替えられます。{lesson && " 課題中はサイトを切り替えられません。"}
      </p>
      <div className={t.wrap}>
        <table className={t.table}>
          <thead>
            <tr>
              <th className={t.th}>名前</th>
              <th className={t.th}>構成</th>
              <th className={t.th} />
            </tr>
          </thead>
          <tbody>
            {ops.sites.map((site) => (
              <tr key={site.id} className={clsx(t.tr, !canManage && "cursor-default")} onClick={() => canManage && setEdit(site.id)}>
                <td className={t.td}>
                  <span className="inline-flex items-center gap-2 font-medium">
                    {site.name}
                    {site.id === ops.activeSiteId && <Badge tone="accent">表示中</Badge>}
                  </span>
                </td>
                <td className={clsx(t.td, "text-fg-2")}>{summary(site)}</td>
                <td className={clsx(t.td, "text-right")}>
                  {site.id !== ops.activeSiteId && (
                    <Button
                      className="h-7"
                      disabled={!!lesson || !siteAllowed(site.id, ops)}
                      onClick={(e) => {
                        e.stopPropagation();
                        ops.switchSite(site.id);
                      }}
                    >
                      開く
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <SitePanel key={edit} id={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function SitePanel({ id, onClose }: { id: string; onClose: () => void }) {
  const ops = useOps();
  const isNew = id === "new";
  const site = ops.sites.find((x) => x.id === id);
  const [name, setName] = useState(site?.name ?? "");
  const [from, setFrom] = useState<"default" | "copy">("default");
  const trimmed = name.trim();
  const conflict = ops.sites.some((x) => x.id !== id && x.name.trim() === trimmed);
  const save = () => {
    if (isNew) ops.addSite(trimmed, from);
    else ops.renameSite(id, trimmed);
    onClose();
  };
  return (
    <SidePanel
      open
      onClose={onClose}
      title={isNew ? "サイトを作成" : (site?.name ?? "")}
      footer={
        <>
          <Button variant="primary" disabled={!trimmed || conflict || (!isNew && trimmed === site?.name)} onClick={save}>
            {isNew ? "サイトを追加" : "変更を適用"}
          </Button>
          {!isNew && (
            <Button
              variant="danger"
              disabled={id === ops.activeSiteId || ops.sites.length <= 1}
              onClick={() => {
                if (!confirm(`サイト「${site?.name}」を削除しますか？ 構成は元に戻せません。`)) return;
                ops.deleteSite(id);
                onClose();
              }}
            >
              削除
            </Button>
          )}
        </>
      }
    >
      <Field label="サイト名" error={conflict ? "同じ名前のサイトがあります。" : undefined}>
        <Input aria-label="サイト名" value={name} placeholder="例: 店舗" onChange={(e) => setName(e.target.value)} />
      </Field>
      {isNew && (
        <Field label="初期の構成" hint="コピーすると、表示中のサイトの機器・ネットワーク・ポリシーを複製します。">
          <Segmented<"default" | "copy">
            value={from}
            onChange={setFrom}
            options={[
              { value: "default", label: "標準の構成" },
              { value: "copy", label: "表示中のサイトをコピー" },
            ]}
          />
        </Field>
      )}
      {!isNew && id === ops.activeSiteId && <p className="text-[12px] text-muted">表示中のサイトは削除できません。別のサイトを開いてから削除します。</p>}
    </SidePanel>
  );
}
