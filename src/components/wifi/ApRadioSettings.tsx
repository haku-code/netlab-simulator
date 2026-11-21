"use client";

import { Field, Select } from "@/components/ui";
import { type Band } from "@/lib/floor";
import type { Device, Scenario } from "@/lib/model";
import { uplinkOf } from "@/lib/net/simulate";
import { apInterference, apRadio, meshLink, radioChannels, WIFI_WIDTHS } from "@/lib/net/wifi-radio";
import { useStore } from "@/lib/store";

export function ApRadioSettings({ s, ap }: { s: Scenario; ap: Device }) {
  const mutate = useStore((x) => x.mutate);
  const mesh = ap.meshParentId ? meshLink(s, ap) : null;
  const online = mesh && uplinkOf(s, ap.id).online;
  const parentOptions = s.devices.filter((d) => d.type === "ap" && d.id !== ap.id)
    .map((d) => ({ value: d.id, label: d.name }));
  if (ap.meshParentId && !parentOptions.some((opt) => opt.value === ap.meshParentId))
    parentOptions.push({ value: ap.meshParentId, label: "見つからない AP" });

  return (
    <>
      <Field label="アップリンク" hint="メッシュでは指定した親 AP に 5 GHz で接続します。">
        <Select
          aria-label="AP アップリンク"
          value={ap.meshParentId ?? ""}
          options={[{ value: "", label: "有線 (Ethernet)" }, ...parentOptions]}
          onChange={(parentId) => mutate((sc) => {
            const device = sc.devices.find((d) => d.id === ap.id);
            if (device) device.meshParentId = parentId || undefined;
          })}
        />
        {ap.meshParentId && (
          <p role="status" className="mt-1 text-[12px] text-fg-2">
            {online ? `メッシュ接続済み · ch ${mesh.channel} / ${mesh.width} MHz · ${mesh.rssi} dBm · ${mesh.rate} Mbps`
              : "メッシュ未接続。親 AP までの電波と、親をたどった先の有線接続を確認してください。"}
          </p>
        )}
      </Field>
      {(["2.4", "5", "6"] as const).map((band) => (
        <RadioBand key={band} s={s} ap={ap} band={band} />
      ))}
    </>
  );
}

function RadioBand({ s, ap, band }: { s: Scenario; ap: Device; band: Band }) {
  const mutate = useStore((x) => x.mutate);
  const { channel, width } = apRadio(ap, band);
  const { neighbors } = apInterference(s, ap, band);
  const change = (selectedChannel: number, selectedWidth: number) => mutate((sc) => {
    const device = sc.devices.find((d) => d.id === ap.id);
    if (device) device.wifiRadios = { ...device.wifiRadios, [band]: { channel: selectedChannel, width: selectedWidth } };
  });

  return (
    <fieldset className="space-y-2 rounded border border-line px-3 pb-3">
      <legend className="px-1 text-[12px] font-medium">{band} GHz</legend>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-[12px]">
          <span>チャンネル</span>
          <Select aria-label={`${band} GHz チャンネル`} value={String(ap.wifiRadios?.[band]?.channel ? channel : 0)}
            options={[{ value: "0", label: `自動 (ch ${channel})` }, ...radioChannels(band, width).map((c) => ({ value: String(c), label: `ch ${c}` }))]}
            onChange={(v) => change(Number(v), width)} />
        </label>
        <label className="space-y-1 text-[12px]">
          <span>チャネル幅</span>
          <Select aria-label={`${band} GHz チャネル幅`} value={String(width)}
            options={WIFI_WIDTHS[band].map((w) => ({ value: String(w), label: `${w} MHz` }))}
            onChange={(v) => {
              const next = Number(v);
              const selected = ap.wifiRadios?.[band]?.channel ?? 0;
              change(radioChannels(band, next).includes(selected) ? selected : 0, next);
            }} />
        </label>
      </div>
      {s.floor && <p className={neighbors ? "text-[12px] text-warn" : "text-[12px] text-muted"}>この AP の位置でチャネルが重なる AP: {neighbors} 台</p>}
    </fieldset>
  );
}
