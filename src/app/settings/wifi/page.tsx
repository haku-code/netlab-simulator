"use client";

import clsx from "clsx";
import { Eye, EyeOff, Plus } from "lucide-react";
import { useState } from "react";
import { BackLink, Button, Checkbox, FormRow, FormSection, Input, Notice, PageHeader, Segmented, Select, Toggle, table as t, useDraft } from "@/components/ui";
import { networkOptions, useIssues, useQueryId } from "@/lib/hooks";
import { uid, type Scenario, type WifiSsid } from "@/lib/model";
import { findNetwork } from "@/lib/net/simulate";
import { useStore } from "@/lib/store";

const SEC = { wpa3: "WPA3", wpa2: "WPA2", open: "認証なし" } as const;
const BANDS = [
  { v: "2.4", l: "2.4 GHz" },
  { v: "5", l: "5 GHz" },
  { v: "6", l: "6 GHz" },
] as const;

export default function WifiPage() {
  const s = useStore((x) => x.scenario);
  const issues = useIssues().filter((i) => i.area === "wifi");
  const [selId, setSelId] = useQueryId();

  if (selId) return <WifiForm s={s} id={selId} onBack={() => setSelId(null)} />;

  return (
    <>
      <PageHeader title="Wi-Fi" count={s.ssids.length}>
        <Button variant="primary" onClick={() => setSelId("new")}>
          <Plus size={14} /> 新規作成
        </Button>
      </PageHeader>
      <Notice issues={issues} />
      <div className={t.wrap}>
        <table className={t.table}>
          <thead>
            <tr>
              <th className={t.th}>名前</th>
              <th className={t.th}>ネットワーク</th>
              <th className={t.th}>セキュリティ</th>
              <th className={t.th}>周波数帯</th>
              <th className={t.th}>配信 AP</th>
              <th className={t.th}>クライアント間の分離</th>
              <th className={clsx(t.th, "text-right")}>クライアント</th>
            </tr>
          </thead>
          <tbody>
            {s.ssids.map((w) => {
              const n = findNetwork(s, w.networkId);
              return (
                <tr key={w.id} className={t.tr} onClick={() => setSelId(w.id)}>
                  <td className={clsx(t.td, "font-medium")}>{w.name}</td>
                  <td className={t.td}>{n ? n.name : <span className="text-err">未割当</span>}</td>
                  <td className={clsx(t.td, "text-fg-2")}>{SEC[w.security]}</td>
                  <td className={clsx(t.td, "text-fg-2")}>{w.bands.map((b) => `${b} GHz`).join(", ")}</td>
                  <td className={clsx(t.td, "text-fg-2")}>
                    {!w.apIds ? "すべての AP" : s.devices.filter((d) => w.apIds!.includes(d.id)).map((d) => d.name).join(", ") || <span className="text-warn">なし</span>}
                  </td>
                  <td className={clsx(t.td, "text-fg-2")}>{w.clientIsolation ? "有効" : "無効"}</td>
                  <td className={clsx(t.td, "tnum text-right")}>{s.clients.filter((c) => c.connection.type === "wifi" && c.connection.ssidId === w.id).length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function WifiForm({ s, id, onBack }: { s: Scenario; id: string; onBack: () => void }) {
  const mutate = useStore((x) => x.mutate);
  const issues = useIssues().filter((i) => i.targetId === id);
  const isNew = id === "new";
  const existing = s.ssids.find((w) => w.id === id);
  const blank: WifiSsid = { id: uid("ssid"), name: "", networkId: s.networks[0]?.id ?? null, security: "wpa2", password: "", clientIsolation: false, bands: ["2.4", "5"] };
  const { draft, update, dirty, reset } = useDraft<WifiSsid>(isNew ? blank : existing, id);
  const [showPw, setShowPw] = useState(false);
  if (!draft) return <BackLink onClick={onBack}>Wi-Fi</BackLink>;
  const inUse = s.clients.some((c) => c.connection.type === "wifi" && c.connection.ssidId === id);

  const save = () => {
    mutate((sc) => {
      const w = { ...draft, name: draft.name.trim() || "新しい Wi-Fi" };
      const i = sc.ssids.findIndex((x) => x.id === w.id);
      // ネットワークが変わると AP が再プロビジョニングされ、端末は再接続して IP を取り直す
      if (i >= 0 && sc.ssids[i].networkId !== w.networkId)
        for (const c of sc.clients) if (c.connection.type === "wifi" && c.connection.ssidId === w.id) c.lease = null;
      if (i >= 0) sc.ssids[i] = w;
      else sc.ssids.push(w);
    });
    onBack();
  };

  return (
    <div className="max-w-3xl">
      <BackLink onClick={onBack}>Wi-Fi</BackLink>
      <h1 className="mb-2 text-[15px] font-semibold">{isNew ? "Wi-Fi を新規作成" : existing?.name}</h1>
      <Notice issues={issues} />
      <FormSection title="基本設定">
        <FormRow label="名前 (SSID)" term="ssid">
          <Input value={draft.name} onChange={(e) => update((w) => (w.name = e.target.value))} />
        </FormRow>
        <FormRow label="パスワード">
          <div className="relative">
            <Input
              type={showPw ? "text" : "password"}
              className="pr-9"
              value={draft.password}
              disabled={draft.security === "open"}
              onChange={(e) => update((w) => (w.password = e.target.value))}
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-muted hover:text-fg"
              aria-label={showPw ? "パスワードを隠す" : "パスワードを表示"}
            >
              {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </FormRow>
        <FormRow label="ネットワーク" term="vlan" hint="AP はこの SSID の通信を選んだネットワークの VLAN タグを付けて上流へ送ります。">
          <Select value={draft.networkId ?? ""} onChange={(v) => update((w) => (w.networkId = v || null))} options={networkOptions(s, { none: "なし" })} />
        </FormRow>
        <FormRow label="配信 AP" term="broadcasting" hint="この SSID を電波に出す AP。端末は近くの AP が配信している SSID しか見えません。">
          <Segmented
            value={draft.apIds ? "specific" : "all"}
            onChange={(v) => update((w) => (w.apIds = v === "all" ? undefined : s.devices.filter((d) => d.type === "ap").map((d) => d.id)))}
            options={[
              { value: "all", label: "すべての AP" },
              { value: "specific", label: "指定した AP" },
            ]}
          />
          {draft.apIds && (
            <div className="mt-2 rounded border border-line bg-surface px-3 py-1.5">
              {s.devices
                .filter((d) => d.type === "ap")
                .map((ap) => (
                  <Checkbox
                    key={ap.id}
                    checked={draft.apIds!.includes(ap.id)}
                    onChange={(on) => update((w) => (w.apIds = on ? [...(w.apIds ?? []), ap.id] : (w.apIds ?? []).filter((x) => x !== ap.id)))}
                    label={ap.name}
                  />
                ))}
            </div>
          )}
        </FormRow>
      </FormSection>
      <FormSection title="詳細設定">
        <FormRow label="セキュリティ方式">
          <Select value={draft.security} onChange={(v) => update((w) => (w.security = v as WifiSsid["security"]))} options={Object.entries(SEC).map(([value, label]) => ({ value, label }))} />
        </FormRow>
        <FormRow label="Wi-Fi 周波数帯">
          <div className="flex gap-4">
            {BANDS.map((b) => (
              <Checkbox
                key={b.v}
                label={b.l}
                checked={draft.bands.includes(b.v)}
                onChange={(on) => update((w) => (w.bands = on ? [...w.bands, b.v] : w.bands.filter((x) => x !== b.v)))}
              />
            ))}
          </div>
        </FormRow>
        <FormRow label="クライアント間の分離" term="isolation">
          <div className="flex h-8 items-center">
            <Toggle checked={draft.clientIsolation} onChange={(v) => update((w) => (w.clientIsolation = v))} />
          </div>
        </FormRow>
      </FormSection>
      <div className="sticky bottom-0 -mx-1 flex gap-2 border-t border-line bg-bg px-1 py-3">
        <Button variant="primary" disabled={!isNew && !dirty} onClick={save}>
          {isNew ? "Wi-Fi を追加" : "変更を適用"}
        </Button>
        {!isNew && (
          <Button disabled={!dirty} onClick={reset}>
            元に戻す
          </Button>
        )}
        {!isNew && (
          <Button
            variant="danger"
            className="ml-auto"
            disabled={inUse}
            title={inUse ? "接続中のクライアントがいると削除できません" : undefined}
            onClick={() => {
              mutate((sc) => {
                sc.ssids = sc.ssids.filter((w) => w.id !== id);
              });
              onBack();
            }}
          >
            削除
          </Button>
        )}
      </div>
    </div>
  );
}
