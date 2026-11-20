"use client";

import { FormRow, FormSection, Input, PageHeader, Select, Status } from "@/components/ui";

/** WAN はシミュレーション外なので表示のみ */
export default function InternetPage() {
  return (
    <div className="max-w-3xl">
      <PageHeader title="インターネット" />
      <FormSection title="主回線 (WAN1)">
        <FormRow label="状態">
          <div className="flex h-8 items-center">
            <Status ok label="接続済み" />
          </div>
        </FormRow>
        <FormRow label="ISP">
          <Input value="NetLab ISP" disabled />
        </FormRow>
        <FormRow label="IPv4 の接続方式">
          <Select value="dhcp" onChange={() => {}} disabled options={[{ value: "dhcp", label: "DHCPv4" }]} />
        </FormRow>
        <FormRow label="WAN IP アドレス" hint="学習用シミュレーターのため WAN 側の設定は固定です。">
          <Input className="tnum" value="203.0.113.24" disabled />
        </FormRow>
      </FormSection>
    </div>
  );
}
