"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { Button, Checkbox, Field, Input, PageHeader, Segmented, Select, SidePanel, table as t, useDraft } from "@/components/ui";
import { networkOptions } from "@/lib/hooks";
import { uid, type PortProfile, type TaggedMode } from "@/lib/model";
import { findNetwork } from "@/lib/net/simulate";
import { useStore } from "@/lib/store";
import { taggedLabel } from "@/lib/topo";

/** プロファイルを使っているポート */
function usages(s: ReturnType<typeof useStore.getState>["scenario"], id: string) {
  return s.devices.flatMap((d) => d.ports.filter((p) => p.profileId === id).map((p) => ({ device: d, port: p })));
}

export default function PortProfilesPage() {
  const s = useStore((x) => x.scenario);
  const [edit, setEdit] = useState<string | null>(null);
  const profiles = s.portProfiles ?? [];
  return (
    <>
      <PageHeader title="ポートプロファイル" count={profiles.length}>
        <Button variant="primary" onClick={() => setEdit("new")}>
          <Plus size={14} /> プロファイルを作成
        </Button>
      </PageHeader>
      <p className="mb-4 max-w-3xl text-[12.5px] text-fg-2">
        ネイティブ VLAN・タグ付き VLAN・PoE の組み合わせに名前を付け、ポートマネージャーで複数のポートに適用します。プロファイルを変更すると、適用中のポートすべてに反映されます。
      </p>
      <div className={t.wrap}>
        <table className={t.table}>
          <thead>
            <tr>
              <th className={t.th}>名前</th>
              <th className={t.th}>ネイティブ VLAN</th>
              <th className={t.th}>タグ付き VLAN の管理</th>
              <th className={t.th}>PoE</th>
              <th className={t.th}>適用中のポート</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => {
              const used = usages(s, p.id);
              return (
                <tr key={p.id} className={t.tr} onClick={() => setEdit(p.id)}>
                  <td className={t.td}>
                    <button type="button" className="font-medium hover:underline">
                      {p.name}
                    </button>
                  </td>
                  <td className={t.td}>{findNetwork(s, p.nativeNetworkId)?.name ?? <span className="text-muted">なし</span>}</td>
                  <td className={`${t.td} text-fg-2`}>{taggedLabel(s, p)}</td>
                  <td className={t.td}>{p.poe === "off" ? "オフ" : "自動"}</td>
                  <td className={`${t.td} whitespace-normal py-2 text-fg-2`}>{used.map((u) => `${u.device.name} ${u.port.idx}`).join("、") || "—"}</td>
                </tr>
              );
            })}
            {!profiles.length && (
              <tr>
                <td className={`${t.td} text-muted`} colSpan={5}>
                  プロファイルはまだありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {edit && <ProfilePanel key={edit} id={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function ProfilePanel({ id, onClose }: { id: string; onClose: () => void }) {
  const s = useStore((x) => x.scenario);
  const mutate = useStore((x) => x.mutate);
  const isNew = id === "new";
  const existing = s.portProfiles?.find((p) => p.id === id);
  const [blank] = useState<PortProfile>(() => ({
    id: uid("pp"),
    name: "",
    nativeNetworkId: s.networks[0]?.id ?? null,
    tagged: "none",
    taggedNetworkIds: [],
    poe: "auto",
  }));
  const { draft, update, dirty, reset } = useDraft(isNew ? blank : existing, id);
  // 適用先のポート（新規作成時にまとめて適用できる）
  const [targets, setTargets] = useState<string[]>(() => (existing ? usages(s, existing.id).map((u) => `${u.device.id}|${u.port.id}`) : []));
  const initialTargets = existing ? usages(s, existing.id).map((u) => `${u.device.id}|${u.port.id}`) : [];
  if (!draft) return null;

  const name = draft.name.trim();
  const conflict = s.portProfiles?.some((p) => p.id !== draft.id && p.name.trim() === name);
  const targetsChanged = targets.length !== initialTargets.length || targets.some((x) => !initialTargets.includes(x));
  const changed = dirty || targetsChanged;
  const switches = s.devices.filter((d) => d.type !== "ap");

  const save = () => {
    mutate((sc) => {
      const list = (sc.portProfiles ??= []);
      const next = { ...draft, name };
      const i = list.findIndex((p) => p.id === draft.id);
      if (i === -1) list.push(next);
      else list[i] = next;
      for (const d of sc.devices)
        for (const p of d.ports) {
          const on = targets.includes(`${d.id}|${p.id}`);
          if (on) p.profileId = draft.id;
          else if (p.profileId === draft.id) delete p.profileId;
        }
    });
    onClose();
  };
  const remove = () => {
    if (!confirm(`プロファイル「${existing?.name}」を削除しますか？ 適用中のポートは現在の設定のまま個別設定に戻ります。`)) return;
    mutate((sc) => {
      sc.portProfiles = (sc.portProfiles ?? []).filter((p) => p.id !== id);
      for (const d of sc.devices) for (const p of d.ports) if (p.profileId === id) delete p.profileId;
    });
    onClose();
  };

  return (
    <SidePanel
      open
      onClose={onClose}
      title={isNew ? "ポートプロファイルを作成" : (existing?.name ?? draft.name)}
      footer={
        <>
          <Button variant="primary" onClick={save} disabled={!name || !!conflict || (!isNew && !changed)}>
            {isNew ? "プロファイルを追加" : "変更を適用"}
          </Button>
          {!isNew && (
            <Button
              disabled={!changed}
              onClick={() => {
                reset();
                setTargets(initialTargets);
              }}
            >
              元に戻す
            </Button>
          )}
          {!isNew && (
            <Button variant="danger" onClick={remove}>
              削除
            </Button>
          )}
        </>
      }
    >
      <Field label="名前" error={conflict ? "同じ名前のプロファイルがあります。" : undefined}>
        <Input aria-label="プロファイル名" value={draft.name} placeholder="例: カメラ用" onChange={(e) => update((p) => (p.name = e.target.value))} />
      </Field>
      <Field label="ネイティブ VLAN / ネットワーク" term="native">
        <Select value={draft.nativeNetworkId ?? ""} onChange={(v) => update((p) => (p.nativeNetworkId = v || null))} options={networkOptions(s, { none: "なし" })} />
      </Field>
      <Field label="タグ付き VLAN の管理" term="trunk">
        <Segmented<TaggedMode>
          value={draft.tagged}
          onChange={(v) => update((p) => (p.tagged = v))}
          options={[
            { value: "all", label: "すべて許可" },
            { value: "none", label: "すべて拒否" },
            { value: "custom", label: "カスタム" },
          ]}
        />
        {draft.tagged === "custom" && (
          <div className="mt-2 rounded border border-line px-3 py-1.5">
            {s.networks
              .filter((n) => n.id !== draft.nativeNetworkId)
              .map((n) => (
                <Checkbox
                  key={n.id}
                  checked={draft.taggedNetworkIds.includes(n.id)}
                  onChange={(v) => update((p) => (p.taggedNetworkIds = v ? [...p.taggedNetworkIds, n.id] : p.taggedNetworkIds.filter((x) => x !== n.id)))}
                  label={
                    <>
                      {n.name} <span className="text-muted">({n.vlanId})</span>
                    </>
                  }
                />
              ))}
          </div>
        )}
      </Field>
      <Field label="PoE" term="poe">
        <Segmented<"auto" | "off">
          value={draft.poe}
          onChange={(v) => update((p) => (p.poe = v))}
          options={[
            { value: "auto", label: "PoE+（自動）" },
            { value: "off", label: "オフ" },
          ]}
        />
      </Field>
      <Field label="適用するポート" hint="アップリンクや AP のポートに適用すると、VLAN が変わって通信できなくなることがあります。">
        <div className="max-h-72 space-y-2 overflow-y-auto rounded border border-line px-3 py-2">
          {switches.map((d) => (
            <div key={d.id}>
              <div className="mb-0.5 text-[12px] font-medium text-muted">{d.name}</div>
              <div className="grid grid-cols-4 gap-x-2">
                {d.ports.map((p) => {
                  const key = `${d.id}|${p.id}`;
                  return (
                    <Checkbox
                      key={key}
                      checked={targets.includes(key)}
                      onChange={(v) => setTargets((x) => (v ? [...x, key] : x.filter((k) => k !== key)))}
                      label={<span className="tnum">{p.idx}</span>}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Field>
    </SidePanel>
  );
}
