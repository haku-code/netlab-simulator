"use client";

import { useState } from "react";
import type { WifiSsid } from "@/lib/model";
import { useStore } from "@/lib/store";

export function GuestPortal({ clientId, ssid, reachable }: { clientId: string; ssid: WifiSsid; reachable: boolean }) {
  const signIn = useStore((s) => s.signInGuest);
  const [password, setPassword] = useState("");
  const [failed, setFailed] = useState(false);

  return (
    <form
      className="space-y-2 rounded border border-line p-3 text-[12px]"
      onSubmit={(event) => {
        event.preventDefault();
        setFailed(!signIn(clientId, password));
        setPassword("");
      }}
    >
      <h2 className="text-[14px] font-semibold">{ssid.name} · ゲストログイン</h2>
      <p>通信を開始するには、ゲスト用のアクセスコードを入力してください。</p>
      <label className="block space-y-1">
        <span>アクセスコード</span>
        <input
          type="password"
          autoComplete="off"
          required
          value={password}
          disabled={!reachable}
          onChange={(event) => setPassword(event.target.value)}
          className="block w-full rounded border border-line bg-transparent px-2 py-1"
        />
      </label>
      <button disabled={!reachable} className="rounded bg-accent px-3 py-1 text-white disabled:opacity-50">ログイン</button>
      {!reachable && <p role="status">ゲートウェイに接続できる状態でログインしてください。</p>}
      {failed && <p role="alert">アクセスコードが一致しません。</p>}
    </form>
  );
}
