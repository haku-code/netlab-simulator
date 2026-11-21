"use client";

import { useState } from "react";
import type { Client, Scenario } from "@/lib/model";
import { uid } from "@/lib/model";
import type { ProbeResult } from "@/lib/emu";
import type { IpFamily } from "@/lib/net/ipv6";
import { useStore } from "@/lib/store";
import { virtualWebCapture, type WebEvent } from "@/lib/web";

type Transport = { scheme: "http" | "https"; port: number };
const demo = { user: "member", password: "lab-demo" };

export function WebCapture({ scenario, clientId, transport, result, problem, event, family }: {
  scenario: Scenario;
  clientId: string;
  transport: Transport;
  result: ProbeResult;
  problem: string | null;
  event: WebEvent;
  family?: IpFamily;
}) {
  const capture = virtualWebCapture(scenario, clientId, transport.scheme, transport.port, result, problem, event, family);
  const target = "target" in result && "ip" in result.target ? result.target.ip : undefined;
  const endpoint = target?.includes(":") ? `[${target}]` : target;
  return (
    <div className="space-y-3 text-[12px]">
      <p>NetLab の仮想パケット · アプリケーション欄には実習用のサンプル値を表示します。</p>
      <p className="font-mono">{capture.ip ?? "—"} → {endpoint ?? "—"}:{transport.port}</p>
      <dl className="grid gap-2.5">
        <div><dt className="font-semibold">TCP</dt><dd>{capture.transport.join(" → ") || "通信なし"}</dd></div>
        {transport.scheme === "https" && <div><dt className="font-semibold">TLS 1.3</dt><dd>{capture.handshake.join(" → ") || "ハンドシェイクなし"}</dd></div>}
        <div><dt className="font-semibold">AP 通過後 / 有線区間</dt><dd><pre className="whitespace-pre-wrap break-words">{capture.application}</pre></dd></div>
        {capture.radio && (
          <div>
            <dt className="font-semibold">無線区間 · {capture.radio.label}</dt>
            {capture.radio.radio === "legacy" && <dd>旧方式で無線側の保護が破られた場合の例です。</dd>}
            <dd><pre className="whitespace-pre-wrap break-words">{capture.airPayload}</pre></dd>
          </div>
        )}
      </dl>
    </div>
  );
}

export function WebLabSite({ server, onTraffic }: {
  server: Client;
  onTraffic: (event: WebEvent) => void;
}) {
  const service = useStore((s) => s.scenario.clients.find((c) => c.id === server.id)?.webService);
  const mutate = useStore((s) => s.mutate);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [post, setPost] = useState("");
  const [error, setError] = useState("");
  if (!service) return null;

  const field = "w-full rounded-md border border-[#c5d2c8] bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-[#216044]";
  const button = "rounded-md bg-[#216044] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#184a34]";

  return (
    <div className="min-h-full bg-[#f6f8f3] text-[#192e24]">
      <header className="border-b border-[#dfe6db] bg-[#e8efe4] px-4 py-4">
        <h1 className="text-lg font-semibold">{server.name}</h1>
        <p className="font-mono text-[11px]">{service.host}</p>
      </header>
      {service.kind === "website" ? (
        <article className="space-y-2 px-4 py-4 text-[13px]">
          <h2 className="text-base font-semibold">ようこそ、NetLab の Web サイトへ</h2>
          <p>このページは仮想 Web サーバーから配信されています。HTTP と HTTPS で開き、通信キャプチャを比べてみましょう。</p>
        </article>
      ) : signedIn ? (
        <section aria-label="会員限定の投稿" className="space-y-3 px-4 py-4 text-[13px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">会員限定の投稿</h2>
            <button className="underline" onClick={() => {
              setSignedIn(false);
              setPost("");
              onTraffic({ method: "GET", path: "/", status: "200 OK" });
            }}>ログアウト</button>
          </div>
          <form className="space-y-2" onSubmit={(e) => {
            e.preventDefault();
            const body = post.trim();
            if (!body) return;
            mutate((s) => {
              const current = s.clients.find((c) => c.id === server.id)?.webService;
              if (current?.kind === "forum") current.posts = [...(current.posts ?? []), { id: uid("post"), author: demo.user, body }];
            });
            setPost("");
            onTraffic({ method: "POST", path: "/posts", status: "201 Created" });
          }}>
            <label className="block space-y-1"><span>投稿内容</span><textarea value={post} onChange={(e) => setPost(e.target.value)} required maxLength={1000} className={field} rows={2} /></label>
            <button className={button}>投稿する</button>
          </form>
          {service.posts?.length ? (
            <ul className="divide-y divide-[#dfe6db] rounded-md border border-[#dfe6db] bg-white">
              {[...service.posts].reverse().map((item) => (
                <li key={item.id} className="px-3 py-2">
                  <p className="text-[11px] font-medium text-[#416456]">{item.author}</p>
                  <p className="whitespace-pre-wrap break-words">{item.body}</p>
                </li>
              ))}
            </ul>
          ) : <p className="text-[#416456]">まだ投稿はありません。</p>}
        </section>
      ) : (
        <section className="space-y-2 px-4 py-4 text-[13px]">
          <h2 className="font-semibold">会員ログイン</h2>
          <p>実習用アカウントは <code>{demo.user}</code> / <code>{demo.password}</code> です。</p>
          <form className="grid gap-2" autoComplete="off" onSubmit={(e) => {
            e.preventDefault();
            const ok = login === demo.user && password === demo.password;
            setSignedIn(ok);
            setError(ok ? "" : "ユーザー名またはパスワードが違います。");
            setPassword("");
            onTraffic({ method: "POST", path: "/login", status: ok ? "200 OK" : "401 Unauthorized" });
          }}>
            <label className="grid gap-1">ユーザー名<input value={login} onChange={(e) => setLogin(e.target.value)} className={field} required /></label>
            <label className="grid gap-1">パスワード<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} required /></label>
            {error && <p role="alert" className="text-[#9d282c]">{error}</p>}
            <button className={`${button} justify-self-start`}>ログイン</button>
          </form>
        </section>
      )}
    </div>
  );
}
