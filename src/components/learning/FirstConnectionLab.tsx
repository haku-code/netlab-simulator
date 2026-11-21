"use client";

import clsx from "clsx";
import { Globe, Laptop, Router } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Term } from "@/components/ui";
import { FIRST_CONNECTION, firstConnection } from "@/lib/theory/first-connection";

export function FirstConnectionLab() {
  const [setup, setSetup] = useState(FIRST_CONNECTION);
  const [opened, setOpened] = useState(false);
  const [testedIp, setTestedIp] = useState(false);
  const result = useMemo(() => firstConnection(setup), [setup]);
  const toggle = (part: keyof typeof FIRST_CONNECTION) => {
    setSetup((previous) => previous[part] ? { ...FIRST_CONNECTION, [part]: false } : FIRST_CONNECTION);
    setOpened(true);
    setTestedIp(false);
  };
  const outcome = result.web.status === "ok" ? "Web サイトを開けました。PC はルーターを経由して Web サーバーと通信できています。"
    : !setup.cable ? "PC とルーターの間のケーブルが抜けています。ケーブルをつないでもう一度試しましょう。"
    : !setup.dhcp ? "PC が IP アドレスを受け取れません。DHCP をオンにして、PC にアドレスを配りましょう。"
    : "PC は IP アドレスを持っていますが、DNS に問い合わせできず、example.com の IP アドレスが分かりません。";

  return (
    <div className="space-y-5 p-4 sm:p-5">
      <p className="text-[13px] text-fg-2">この実習では、設定を変えるたびに PC をつなぎ直した状態から試します。実習専用の構成で、何度でも試せます。</p>
      <ol className="list-decimal space-y-2 pl-5 text-fg-2">
        <li>「Web サイトを開く」を押して、PC からページが開くことを確かめます。</li>
        <li>ケーブルを抜いて、結果を見ます。次にケーブルをつないで、通信が戻るか確かめます。</li>
        <li>「DHCP を止める」と「DNS を止める」を順番に押し、結果を比べます。実習では原因を一つずつ切り替えます。</li>
      </ol>
      <div className="rounded-lg border border-line bg-surface-2 px-2 py-4 sm:px-5">
        <ul aria-label="通信の経路" className="flex items-start justify-center gap-2 text-center sm:gap-4">
          <li className="min-w-12">
            <Laptop size={23} className="mx-auto mb-1" aria-hidden />
            <span>PC</span>
          </li>
          <li className="min-w-0 grow self-center sm:grow-0">
            <div className={clsx("mx-auto w-full max-w-20 border-t-2 sm:w-20", setup.cable ? "border-accent" : "border-dashed border-err")} />
            <span className="text-[11px] text-fg-2">{setup.cable ? "接続中" : "未接続"}</span>
          </li>
          <li className="min-w-14">
            <Router size={23} className="mx-auto mb-1" aria-hidden />
            <span>ルーター</span>
          </li>
          <li aria-hidden="true" className="grow self-center border-t-2 border-line sm:w-20 sm:grow-0" />
          <li className="min-w-14">
            <Globe size={23} className="mx-auto mb-1" aria-hidden />
            <span>Web サイト</span>
          </li>
        </ul>
        <dl className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[12px]">
          <div className="flex items-center gap-1.5"><dt>PC の IP <Term id="ip" /></dt><dd className="font-mono">{result.ip ?? "未取得"}</dd></div>
          <div className="flex items-center gap-1.5"><dt>ゲートウェイ <Term id="gateway" /></dt><dd className="font-mono">{result.ip ? result.gateway : "未取得"}</dd></div>
          <div className="flex items-center gap-1.5"><dt>DNS <Term id="dns" /></dt><dd className={setup.dns ? "text-fg-2" : "text-err"}>{setup.dns ? "稼働中" : "停止中"}</dd></div>
        </dl>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => toggle("cable")}>{setup.cable ? "ケーブルを抜く" : "ケーブルをつなぐ"}</Button>
        <Button onClick={() => toggle("dhcp")}>{setup.dhcp ? "DHCP を止める" : "DHCP を戻す"}</Button>
        <Button onClick={() => toggle("dns")}>{setup.dns ? "DNS を止める" : "DNS を戻す"}</Button>
        <Button variant="primary" onClick={() => setOpened(true)}>Web サイトを開く</Button>
      </div>
      <div role="status" className={clsx("rounded border border-line px-3 py-2 text-[13px]", opened && (result.web.status === "ok" ? "text-ok" : "text-err"))}>
        {opened ? outcome : "Web サイトを開くと、通信できるかここに表示します。"}
      </div>
      {!setup.dns && (
        <section aria-label="DNS の比較実習" className="space-y-2 rounded border border-line px-3 py-3 text-[13px]">
          <h3 className="font-semibold">IP アドレスが分かっていたら？</h3>
          <p className="text-fg-2">Web サーバーの IP アドレス <span className="font-mono">{result.webIp}</span> を指定して、サーバーまで通信できるか確かめます。</p>
          <Button onClick={() => setTestedIp(true)}>IP アドレスに直接接続</Button>
          <div role="status">
            {testedIp && (result.direct.status === "ok"
              ? <p className="text-ok">サーバーに接続できました。IP アドレスを直接指定したので、DNS への問い合わせを省けました。</p>
              : <p className="text-err">サーバーに接続できませんでした。</p>)}
          </div>
        </section>
      )}
      <dl className="grid gap-3 text-[13px] sm:grid-cols-3">
        <div><dt className="font-semibold">IP アドレス</dt><dd className="text-fg-2">通信の相手を指定するときに使う住所です。</dd></div>
        <div><dt className="font-semibold">DHCP</dt><dd className="text-fg-2">PC が使う IP アドレスなどを自動で配ります。</dd></div>
        <div><dt className="font-semibold">DNS</dt><dd className="text-fg-2">example.com のような名前から、通信先の IP アドレスを調べます。</dd></div>
      </dl>
    </div>
  );
}
