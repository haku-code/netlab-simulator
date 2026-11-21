"use client";

import { useState } from "react";
import { Button, Checkbox, FormRow, FormSection, PageHeader, Select, table as t } from "@/components/ui";
import { APP_SIGNATURES, DEFAULT_SECURITY, normalizeDomain, THREAT, validDomain, type SecuritySettings } from "@/lib/net/security";
import { useSecurityLog } from "@/lib/security-log";
import { useStore } from "@/lib/store";

const domains = (value: string) => [...new Set(value.split(/[\s,、]+/).filter(Boolean).map(normalizeDomain))];
const timeFormat = new Intl.DateTimeFormat("ja-JP", { dateStyle: "short", timeStyle: "medium" });

export default function SecurityPage() {
  const saved = useStore((state) => state.scenario.security) ?? DEFAULT_SECURITY;
  const mutate = useStore((state) => state.mutate);
  const events = useSecurityLog((state) => state.events);
  const [draft, setDraft] = useState(saved);
  const [sites, setSites] = useState(saved.sites.join("\n"));
  const [dns, setDns] = useState(saved.dns.join("\n"));
  const next = { ...draft, sites: domains(sites), dns: domains(dns) };
  const dirty = JSON.stringify(next) !== JSON.stringify(saved);
  const invalid = [...next.sites, ...next.dns].some((domain) => !validDomain(domain));

  return (
    <>
      <PageHeader title="セキュリティとコンテンツ" />
      <div className="max-w-3xl">
        <FormSection title="侵入検知と防御">
          <FormRow label="IDS / IPS" hint={`仮想の検知対象は ${THREAT.host} です。端末のブラウザで動作を試せます。`}>
            <Select aria-label="IDS / IPS" value={draft.intrusion} onChange={(intrusion) => setDraft({ ...draft, intrusion: intrusion as SecuritySettings["intrusion"] })}
              options={[{ value: "off", label: "無効" }, { value: "ids", label: "IDS · 検知と記録" }, { value: "ips", label: "IPS · ブロックと記録" }]} />
          </FormRow>
        </FormSection>
        <FormSection title="コンテンツフィルター">
          <FormRow label="アプリをブロック" hint="選択した仮想アプリの通信をブロックします。動画は Smart TV のビデオでも試せます。">
            {(Object.keys(APP_SIGNATURES) as SecuritySettings["apps"]).map((app) => (
              <Checkbox key={app} label={`${APP_SIGNATURES[app].label} · ${APP_SIGNATURES[app].host}`} checked={draft.apps.includes(app)}
                onChange={(on) => setDraft({ ...draft, apps: on ? [...draft.apps, app] : draft.apps.filter((id) => id !== app) })} />
            ))}
          </FormRow>
          <DomainField label="サイトをブロック" hint="指定したドメインとサブドメインへの Web 接続をブロックします。" value={sites} onChange={setSites} />
          <DomainField label="DNS フィルター" hint="指定したドメインとサブドメインの名前解決を拒否します。" value={dns} onChange={setDns} />
        </FormSection>
        <div className="mb-6 flex items-center gap-3">
          <Button variant="primary" disabled={!dirty || invalid} onClick={() => mutate((s) => (s.security = next))}>変更を適用</Button>
          {invalid && <span role="alert" className="text-err">URL や IP アドレスを含めず、ドメイン名を入力してください。</span>}
        </div>
      </div>
      <h2 className="mb-2 text-[15px] font-semibold">セキュリティログ</h2>
      {events.length ? (
        <div className={t.wrap}>
          <table className={t.table}>
            <thead><tr>
              {["時刻", "端末", "宛先", "判定", "理由"].map((label) => <th key={label} className={t.th}>{label}</th>)}
            </tr></thead>
            <tbody>
              {events.map((event, index) => (
                <tr key={`${event.at}-${index}`}>
                  <td className={t.td}>{timeFormat.format(event.at)}</td>
                  <td className={t.td}>{event.client}</td>
                  <td className={t.td}>{event.destination}</td>
                  <td className={t.td}>{event.layer} · {event.action === "block" ? "ブロック" : "検知"}</td>
                  <td className={t.td}>{event.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="text-muted">検知・ブロックの記録はありません。</p>}
    </>
  );
}

function DomainField({ label, hint, value, onChange }: { label: string; hint: string; value: string; onChange: (value: string) => void }) {
  return (
    <FormRow label={label} hint={hint}>
      <textarea aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} rows={2}
        placeholder="example.test" className="w-full rounded border border-line bg-surface px-2 py-1.5 text-[13px]" />
    </FormRow>
  );
}
