"use client";

import { Button, FormRow, Input, Toggle } from "@/components/ui";
import { uid, type Client, type WifiSsid } from "@/lib/model";
import { DEFAULT_ENTERPRISE_USER, wifiMode } from "@/lib/wifi-security";

type Props = {
  draft: WifiSsid;
  clients: Client[];
  update: (edit: (ssid: WifiSsid) => void) => void;
};

export function SsidAuthentication({ draft, clients, update }: Props) {
  const { auth } = wifiMode(draft.security);
  if (auth === "ppsk") return (
    <FormRow label="端末別パスワード (PPSK)" hint="端末ごとに割り当てたパスワードで Wi-Fi に接続します。空欄の端末は接続できません。">
      <div className="space-y-2">
        {clients.map((client) => (
          <label key={client.id} className="grid grid-cols-2 items-center gap-2">
            <span>{client.name}</span>
            <Input type="password" autoComplete="off" value={draft.ppsk?.[client.id] ?? ""} onChange={(e) => update((w) => {
              const value = e.target.value;
              w.ppsk ??= {};
              if (value) w.ppsk[client.id] = value;
              else delete w.ppsk[client.id];
            })} />
          </label>
        ))}
        {!clients.length && <p className="text-muted">端末を追加するとパスワードを割り当てられます。</p>}
      </div>
    </FormRow>
  );
  if (auth !== "enterprise" && auth !== "certificate") return null;

  const radius = draft.radius ?? {
    online: true,
    users: draft.password ? [{ identity: draft.enterpriseIdentity || DEFAULT_ENTERPRISE_USER, password: draft.password }] : [],
  };
  const changeRadius = (edit: (config: NonNullable<WifiSsid["radius"]>) => void) => {
    const config = structuredClone(radius);
    edit(config);
    update((w) => (w.radius = config));
  };

  return (
    <>
      <FormRow label="仮想 RADIUS サーバー" hint="オフにすると、この SSID で認証サーバーが応答しない状態を再現します。">
        <Toggle label="仮想 RADIUS サーバー" checked={radius.online} onChange={(online) => changeRadius((r) => (r.online = online))} />
      </FormRow>
      {auth === "enterprise" ? (
        <FormRow label="RADIUS ユーザー" hint="端末の Wi-Fi 設定で入力したユーザー名とパスワードを照合します。">
          <div className="space-y-2">
            {radius.users.map((user, index) => (
              <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <Input aria-label={`RADIUS ユーザー名 ${index + 1}`} placeholder="ユーザー名" value={user.identity} onChange={(e) => changeRadius((r) => (r.users[index].identity = e.target.value))} />
                <Input aria-label={`RADIUS パスワード ${index + 1}`} placeholder="パスワード" type="password" autoComplete="off" value={user.password} onChange={(e) => changeRadius((r) => (r.users[index].password = e.target.value))} />
                <Button aria-label={`RADIUS ユーザー ${index + 1} を削除`} onClick={() => changeRadius((r) => r.users.splice(index, 1))}>削除</Button>
              </div>
            ))}
            <Button onClick={() => changeRadius((r) => r.users.push({ identity: "", password: "" }))}>ユーザーを追加</Button>
          </div>
        </FormRow>
      ) : <p className="text-[12px] text-muted">クライアントの設定で「実習用 Wi-Fi 証明書」を登録してから接続します。</p>}
    </>
  );
}

export function CaptivePortalSettings({ draft, update }: Pick<Props, "draft" | "update">) {
  return (
    <>
      <FormRow label="ゲストポータル" hint="Wi-Fi 接続後にアクセスコードを入力すると通信が許可されます。">
        <Toggle label="ゲストポータル" checked={!!draft.captivePortal} onChange={(on) => update((w) => {
          w.captivePortal = on ? { id: uid("portal"), password: "" } : undefined;
        })} />
      </FormRow>
      {draft.captivePortal && (
        <FormRow label="ゲスト用アクセスコード">
          <Input aria-label="ゲスト用アクセスコード" type="password" autoComplete="off" value={draft.captivePortal.password} onChange={(e) => update((w) => {
            if (w.captivePortal) w.captivePortal.password = e.target.value;
          })} />
        </FormRow>
      )}
    </>
  );
}
