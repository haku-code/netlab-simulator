"use client";

import Link from "next/link";
import { useState } from "react";
import { LearningHeader } from "@/components/learning/CourseLayout";
import { Card, Input } from "@/components/ui";
import { GLOSSARY } from "@/lib/glossary";
import { LEARNING_REFERENCES } from "@/lib/theory/learning-references";

const normalize = (value: string) => value.normalize("NFKC").toLowerCase();
const entries = Object.entries(GLOSSARY);

export default function GlossaryPage() {
  const [query, setQuery] = useState("");
  const tokens = normalize(query).trim().split(/\s+/).filter(Boolean);
  const matches = entries.filter(([id, entry]) => {
    const links = LEARNING_REFERENCES[id];
    const text = normalize([entry.term, entry.body, ...(links?.sources?.map(({ label }) => label) ?? [])].join(" "));
    return tokens.every((token) => text.includes(token));
  });

  return (
    <>
      <LearningHeader course="glossary" />
      <div className="max-w-4xl space-y-4">
        <Card className="p-4 sm:p-5">
          <h2 className="text-lg font-semibold">用語・規格</h2>
          <p className="mt-2 text-fg-2">規格やプロトコルは、メーカーの違う機器やアプリでも同じ方法でやり取りするための決まりです。</p>
          <dl className="mt-4 grid gap-4 text-[13px] sm:grid-cols-2">
            <div>
              <dt className="font-semibold">IEEE 802 · LAN でデータを運ぶ</dt>
              <dd className="mt-1 text-fg-2">PC をルーターにつなぐところで使います。例えば有線は 802.3、無線 LAN は 802.11、スイッチで通信をグループに分ける VLAN は 802.1Q です。</dd>
              <dd className="mt-1"><a href="https://ieee802.org/" target="_blank" rel="noreferrer" className="text-accent hover:underline">IEEE 802 規格委員会</a></dd>
            </div>
            <div>
              <dt className="font-semibold">IETF と RFC · インターネットの共通ルール</dt>
              <dd className="mt-1 text-fg-2">例えば通信先を指定する IPv6 は RFC 8200、データを順番どおり届ける TCP は RFC 9293 です。RFC は文書の名前で、種類には標準や運用の推奨事項などがあります。</dd>
              <dd className="mt-1"><a href="https://www.ietf.org/process/rfcs/" target="_blank" rel="noreferrer" className="text-accent hover:underline">IETF の RFC 案内</a></dd>
            </div>
          </dl>
        </Card>
        <div className="space-y-2">
          <label className="block font-medium" htmlFor="learning-term-search">用語や規格番号を検索</label>
          <Input id="learning-term-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例  DHCP、802.1Q、RFC 8200" />
          <p className="text-[12px] text-muted" role="status">{matches.length} 件</p>
        </div>
        {matches.length ? (
          <dl className="divide-y divide-line rounded-lg border border-line bg-surface">
            {matches.map(([id, { term, body }]) => {
              const references = LEARNING_REFERENCES[id];
              return (
                <div key={id} className="px-4 py-3">
                  <dt className="font-semibold">{term}</dt>
                  <dd className="mt-1 leading-relaxed text-fg-2">{body}</dd>
                  {(references?.practice || references?.sources) && (
                    <dd className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-accent">
                      {references.practice && <Link href={references.practice.href} className="underline">{references.practice.label}</Link>}
                      {references.sources?.map((source) => (
                        <a key={source.label} href={source.href} target="_blank" rel="noreferrer" className="underline">{source.label}</a>
                      ))}
                    </dd>
                  )}
                </div>
              );
            })}
          </dl>
        ) : <p className="text-fg-2">一致する用語が見つかりません。別の名前や番号で検索してください。</p>}
      </div>
    </>
  );
}
