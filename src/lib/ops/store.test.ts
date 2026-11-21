import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// ブラウザでだけ動く構成ストアとの接続を試すため、window と localStorage を用意する
const mem = new Map<string, string>();
beforeAll(() => {
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  });
  vi.useFakeTimers();
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function load() {
  const { useStore } = await import("../store");
  const ops = await import("./store");
  return { useStore, ...ops };
}

describe("operations store", () => {
  it("records events for configuration changes", async () => {
    const { useStore, useOps } = await load();
    useStore.getState().mutate((s) => {
      const pc = s.clients.find((c) => c.id === "pc")!;
      pc.connection = { type: "wired", deviceId: null, portId: null };
    });
    vi.advanceTimersByTime(200);
    expect(useOps.getState().events[0]).toMatchObject({ category: "client", siteId: "default", message: expect.stringMatching(/Desktop PC が切断/) });
  });

  it("blocks changes from a view-only admin and logs the attempt", async () => {
    const { useStore, useOps } = await load();
    useOps.getState().loginAs("viewer");
    const before = useStore.getState().scenario;
    useStore.getState().mutate((s) => (s.networks[0].name = "Changed"));
    useStore.getState().plugCable("nas", null, null);
    expect(useStore.getState().scenario).toBe(before);
    expect(useOps.getState().events[0].message).toMatch(/Viewer（表示のみ）による変更を拒否/);
    useOps.getState().loginAs("owner");
    useStore.getState().mutate((s) => (s.networks[0].name = "Changed"));
    expect(useStore.getState().scenario.networks[0].name).toBe("Changed");
  });

  it("keeps a separate configuration per site", async () => {
    const { useStore, useOps } = await load();
    const id = useOps.getState().addSite("Shop", "default")!;
    useOps.getState().switchSite(id);
    expect(useStore.getState().scenario.networks[0].name).toBe("Default");
    useStore.getState().mutate((s) => (s.networks[0].name = "Shop LAN"));
    useOps.getState().switchSite("default");
    expect(useStore.getState().scenario.networks[0].name).toBe("Changed");
    useOps.getState().switchSite(id);
    expect(useStore.getState().scenario.networks[0].name).toBe("Shop LAN");
    // サイトごとにイベントが分かれる
    vi.advanceTimersByTime(200);
    expect(useOps.getState().events.filter((e) => e.siteId === id).some((e) => /Shop/.test(e.message))).toBe(true);
    useOps.getState().switchSite("default");
  });

  it("site admins cannot open other sites", async () => {
    const { useOps, siteAllowed } = await load();
    const shop = useOps.getState().sites.find((x) => x.name === "Shop")!;
    useOps.getState().saveAdmin({ id: "mgr", name: "Manager", role: "admin", siteIds: [shop.id] });
    useOps.getState().loginAs("mgr");
    // 担当外のサイトにいたので担当サイトへ移る
    expect(useOps.getState().activeSiteId).toBe(shop.id);
    expect(siteAllowed("default")).toBe(false);
    useOps.getState().switchSite("default");
    expect(useOps.getState().activeSiteId).toBe(shop.id);
    useOps.getState().addSite("Nope", "default");
    expect(useOps.getState().sites.some((x) => x.name === "Nope")).toBe(false);
    useOps.getState().loginAs("owner");
    useOps.getState().switchSite("default");
  });

  it("backs up and restores, keeping an automatic backup of the replaced state", async () => {
    const { useStore, useOps } = await load();
    useOps.getState().backupNow("before rename");
    const saved = useOps.getState().backups[0];
    useStore.getState().mutate((s) => (s.networks[0].name = "Renamed"));
    useOps.getState().restore(saved.file, saved.label);
    expect(useStore.getState().scenario.networks[0].name).toBe("Changed");
    expect(useOps.getState().backups[0]).toMatchObject({ auto: true, label: "復元前の自動バックアップ" });
    expect(useStore.getState().scenario.clients.find((c) => c.id === "iphone")!.lease).not.toBeNull();
  });

  it("adopts a pending device and upgrades firmware with a reboot", async () => {
    const { useStore, useOps, ADOPT_MS, UPGRADE_MS } = await load();
    const { makeDevice } = await import("../scenarios/builders");
    useStore.getState().mutate((s) => {
      const d = makeDevice("ap", "ap9", "New AP");
      d.state = "pending";
      d.firmware = "6.6.77";
      s.devices.push(d);
    });
    useOps.getState().adopt("ap9");
    expect(useStore.getState().scenario.devices.find((d) => d.id === "ap9")!.state).toBe("adopting");
    vi.advanceTimersByTime(ADOPT_MS + 200);
    expect(useStore.getState().scenario.devices.find((d) => d.id === "ap9")!.state).toBeUndefined();
    useOps.getState().upgrade(["ap9"]);
    vi.advanceTimersByTime(UPGRADE_MS + 200);
    const d = useStore.getState().scenario.devices.find((x) => x.id === "ap9")!;
    expect(d.state).toBeUndefined();
    expect(d.firmware).toBe("6.7.31");
    const messages = useOps.getState().events.map((e) => e.message);
    expect(messages.some((m) => /New AP を承認しました/.test(m))).toBe(true);
    expect(messages.some((m) => /New AP のファームウェアを 6\.7\.31 に更新/.test(m))).toBe(true);
  });
});
