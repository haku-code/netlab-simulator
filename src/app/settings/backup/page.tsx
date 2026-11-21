"use client";

import clsx from "clsx";
import { Download, HardDriveDownload, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Badge, Button, PageHeader, table as t } from "@/components/ui";
import { backupFileName, backupSize, makeBackup, parseBackup, type BackupFile } from "@/lib/ops/backup";
import { useCanEdit, useCanManage, useOps } from "@/lib/ops/store";
import { useStore } from "@/lib/store";

const fmt = (ms: number) => new Date(ms).toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

function download(file: BackupFile) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = backupFileName(file);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function BackupPage() {
  const ops = useOps();
  const lesson = useStore((x) => x.activeLessonId);
  const canEdit = useCanEdit();
  const canManage = useCanManage();
  const input = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const site = ops.sites.find((x) => x.id === ops.activeSiteId);

  const restore = (file: BackupFile, label: string) => {
    if (!confirm(`「${label}」の構成でサイト「${site?.name}」を置き換えますか？ 現在の構成は自動でバックアップされます。`)) return;
    ops.restore(file, label);
    setMessage({ tone: "ok", text: `「${label}」から復元しました。端末は DHCP で IP を取り直します。` });
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const parsed = parseBackup(await f.text());
    if (input.current) input.current.value = "";
    if (!parsed.ok) {
      setMessage({ tone: "err", text: `復元できません: ${parsed.reason}` });
      return;
    }
    restore(parsed.backup, f.name);
  };

  return (
    <>
      <PageHeader title="バックアップ" count={ops.backups.length}>
        <Button disabled={!!lesson} onClick={() => download(makeBackup(site?.name ?? "Site", useStore.getState().scenario))}>
          <Download size={14} /> ファイルに書き出す
        </Button>
        <Button disabled={!!lesson || !canManage} onClick={() => input.current?.click()}>
          <Upload size={14} /> ファイルから復元
        </Button>
        <Button variant="primary" disabled={!!lesson || !canEdit} onClick={() => ops.backupNow()}>
          <HardDriveDownload size={14} /> 今すぐバックアップ
        </Button>
        <input ref={input} type="file" accept="application/json,.json" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      </PageHeader>
      <p className="mb-4 max-w-3xl text-[12.5px] text-fg-2">
        表示中のサイト「{site?.name}」の構成（機器・ネットワーク・Wi-Fi・ポリシーなど）を保存します。ブラウザ内に最大 8 件まで保存でき、復元の前には現在の構成を自動でバックアップします。
        {lesson && " 課題中はバックアップと復元を使えません。"}
        {!canManage && " 復元はスーパー管理者だけが行えます。"}
      </p>
      {message && <div className={clsx("mb-3 rounded border px-3 py-2 text-[12.5px]", message.tone === "ok" ? "border-ok/40 bg-ok/10 text-ok" : "border-err/40 bg-err/10 text-err")}>{message.text}</div>}
      <div className={t.wrap}>
        <table className={t.table}>
          <thead>
            <tr>
              <th className={t.th}>日時</th>
              <th className={t.th}>内容</th>
              <th className={t.th}>サイト</th>
              <th className={t.th}>サイズ</th>
              <th className={t.th} />
            </tr>
          </thead>
          <tbody>
            {ops.backups.map((b) => (
              <tr key={b.id} className={clsx(t.tr, "cursor-default")}>
                <td className={clsx(t.td, "tnum")}>{fmt(b.time)}</td>
                <td className={t.td}>
                  <span className="inline-flex items-center gap-2">
                    {b.label}
                    {b.auto && <Badge>自動</Badge>}
                  </span>
                </td>
                <td className={clsx(t.td, "text-fg-2")}>{b.file.siteName}</td>
                <td className={clsx(t.td, "tnum text-fg-2")}>{kb(backupSize(b.file))}</td>
                <td className={clsx(t.td, "text-right")}>
                  <span className="inline-flex gap-1.5">
                    <Button className="h-7" disabled={!!lesson || !canManage} onClick={() => restore(b.file, b.label)}>
                      復元
                    </Button>
                    <Button className="h-7" onClick={() => download(b.file)} title="ファイルに書き出す">
                      <Download size={13} />
                    </Button>
                    <Button className="h-7" variant="danger" disabled={!canManage} onClick={() => confirm("このバックアップを削除しますか？") && ops.deleteBackup(b.id)}>
                      削除
                    </Button>
                  </span>
                </td>
              </tr>
            ))}
            {!ops.backups.length && (
              <tr>
                <td className={clsx(t.td, "text-muted")} colSpan={5}>
                  バックアップはまだありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
