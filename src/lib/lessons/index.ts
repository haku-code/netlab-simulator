import type { Scenario } from "../model";
import { trace, type TraceQuery, type TraceResult } from "../net/simulate";
import { access, link, makeDevice, network, policy, setPort, ssid, trunk, wifi, wired, zones } from "../scenarios/builders";
import { discover } from "../mdns";
import { EXTRA } from "./extra";
import { PHASE_ONE } from "./phase-one";
import { PHASE_THREE } from "./phase-three";
import { baseTopology, q } from "./helpers";

/** 到達性チェック（trace）か、mDNS で見つかるかのチェック */
export type LessonCheck =
  | { label: string; query: TraceQuery; expect: boolean; clock?: NonNullable<Scenario["clock"]> }
  | { label: string; discover: { srcId: string; targetId: string; types: string[] }; expect: boolean };

export interface Lesson {
  id: string;
  title: string;
  level: 1 | 2 | 3;
  summary: string;
  story: string;
  goals: string[];
  concepts: string[];
  hints: string[];
  /** 最初に端末側で試してほしいこと */
  firstSteps?: string[];
  scenario: () => Scenario;
  checks: LessonCheck[];
}

export interface CheckOutcome {
  check: LessonCheck;
  result: TraceResult;
  passed: boolean;
}

const emptyResult = (summary: string, hops: TraceResult["hops"] = []): TraceResult => ({
  ok: false,
  summary,
  hops,
  deviceIds: [],
  linkIds: [],
  clientIds: [],
  failLinkIds: [],
  segments: [],
  failAt: null,
});

export function runChecks(lesson: Lesson, s: Scenario): CheckOutcome[] {
  const exists = (id: string) => id === "internet" || s.clients.some((c) => c.id === id);
  return lesson.checks.map((check) => {
    if ("discover" in check) {
      const { srcId, targetId, types } = check.discover;
      if (!exists(srcId) || !exists(targetId)) return { check, passed: false, result: emptyResult("対象のクライアントが見つかりません。") };
      const found = discover(s, srcId, types).filter((d) => d.client.id === targetId);
      const hit = found.find((d) => d.visible);
      const name = s.clients.find((c) => c.id === targetId)!.name;
      const reason = hit?.reason ?? found[0]?.reason ?? "サービスの広告がありません。";
      const result = {
        ...emptyResult(hit ? `${name} が見つかりました。` : `${name} が見つかりません。`, [
          { status: hit ? ("ok" as const) : ("fail" as const), title: hit ? `mDNS で ${name} を発見` : `mDNS で ${name} が見えない`, detail: reason },
        ]),
        ok: !!hit,
      };
      return { check, result, passed: !!hit === check.expect };
    }
    // 学習者がクライアントを削除した場合も落ちないように
    if (!exists(check.query.srcId) || !exists(check.query.dst))
      return { check, passed: false, result: emptyResult("対象のクライアントが見つかりません（削除された可能性があります）。") };
    const result = trace(check.clock ? { ...s, clock: check.clock } : s, check.query);
    return { check, result, passed: result.ok === check.expect };
  });
}

const CORE: Lesson[] = [
  {
    id: "home-lan",
    title: "はじめての LAN",
    level: 1,
    summary: "DHCP と SSID を設定して、端末がインターネットに出られるようにする",
    story:
      "新しいゲートウェイ・スイッチ・AP を設置しましたが、誰もインターネットに出られません。PC は IP アドレスを取れず、iPhone は Wi-Fi につないでもどのネットワークにも入れないようです。",
    goals: ["Desktop PC がインターネットに出られる", "iPhone がインターネットに出られる", "iPhone から Desktop PC に ping が届く"],
    concepts: ["dhcp", "subnet", "gateway", "ssid"],
    hints: [
      "パケットトレース で Desktop PC → インターネット を試し、どこで止まっているか確認しましょう。",
      "設定 → ネットワーク で Default の DHCP モード を「DHCP サーバー」にし、DHCP の割り当て範囲 (例: 192.168.1.6〜192.168.1.254) を入れます。",
      "設定 → Wi-Fi で「Home」の「ネットワーク」を Default にします。",
    ],
    scenario: () => {
      const { gw, sw, ap, links } = baseTopology("home");
      return {
        networks: [network("lan", "Default", 1, 1, { dhcp: { enabled: false, start: "", end: "" } })],
        zones: zones(),
        devices: [gw, sw, ap],
        links,
        ssids: [ssid("home", "Home", null)],
        clients: [wired("pc", "Desktop PC", "pc", sw, 2), wifi("iphone", "iPhone", "phone", ap, "home")],
        policies: [],
      };
    },
    checks: [
      { label: "Desktop PC → インターネット", query: q("pc", "internet"), expect: true },
      { label: "iPhone → インターネット", query: q("iphone", "internet"), expect: true },
      { label: "iPhone → Desktop PC (ICMP)", query: q("iphone", "pc"), expect: true },
    ],
  },
  {
    id: "guest-wifi",
    title: "ゲスト WiFi を分離する",
    level: 1,
    summary: "ゲスト用ネットワークを Hotspot ゾーンに置き、端末同士も分離する",
    story:
      "来客用 SSID「Guest」を作りましたが、家庭用と同じネットワークにつながっているため、ゲストの端末から自宅 PC の共有フォルダが見えてしまいます。ゲスト同士も互いに見えないようにしたいです。",
    goals: [
      "ゲストはインターネットに出られる",
      "ゲストから Desktop PC (SMB: TCP/445) に届かない",
      "ゲスト同士は通信できない",
      "家族の iPhone からは今まで通り PC に届く",
    ],
    concepts: ["vlan", "zone", "isolation"],
    hints: [
      "設定 → ネットワーク で新しいネットワーク「Guest」を作ります（例: VLAN 20, 192.168.20.1/24）。",
      "Guest ネットワークの「ゾーン」を Hotspot にすると、Hotspot → Internal は既定で すべて拒否 になります。",
      "設定 → Wi-Fi で「Guest」の「ネットワーク」を Guest に変更し、クライアント間の分離 を有効にします。",
    ],
    scenario: () => {
      const { gw, sw, ap, links } = baseTopology("home");
      return {
        networks: [network("lan", "Default", 1, 1)],
        zones: zones(),
        devices: [gw, sw, ap],
        links,
        ssids: [ssid("home", "Home", "lan", { security: "wpa3" }), ssid("guest", "Guest", "lan")],
        clients: [
          wired("pc", "Desktop PC", "pc", sw, 2),
          wifi("iphone", "iPhone", "phone", ap, "home"),
          wifi("guest1", "Guest Phone A", "phone", ap, "guest"),
          wifi("guest2", "Guest Phone B", "phone", ap, "guest"),
        ],
        policies: [],
      };
    },
    checks: [
      { label: "Guest Phone A → インターネット", query: q("guest1", "internet", "tcp", 443), expect: true },
      { label: "Guest Phone A → Desktop PC (TCP/445) が遮断", query: q("guest1", "pc", "tcp", 445), expect: false },
      { label: "Guest Phone A → Guest Phone B が遮断", query: q("guest1", "guest2"), expect: false },
      { label: "iPhone → Desktop PC (TCP/445)", query: q("iphone", "pc", "tcp", 445), expect: true },
      { label: "iPhone → インターネット", query: q("iphone", "internet"), expect: true },
    ],
  },
  {
    id: "iot-vlan",
    title: "IoT 機器を隔離する",
    level: 2,
    summary: "IoT 用ゾーンを作り、Internal → IoT だけを許可する",
    story:
      "スマートプラグとネットワークカメラを IoT 用 VLAN に移しましたが、IoT ネットワークも Internal ゾーンにあるため、IoT 機器から PC へ自由にアクセスできます。PC からはカメラの管理画面 (HTTP) を開きたいです。",
    goals: ["PC → Smart Plug (HTTP: TCP/80) は届く", "IoT 機器 → PC は届かない", "IoT 機器はインターネットに出られる"],
    concepts: ["zone", "policy", "stateful"],
    hints: [
      "同じゾーン内のネットワーク同士は既定で通信できます。",
      "設定 → ゾーン でカスタムゾーン「IoT」を作り、IoT ネットワークを移します。新しいゾーンは他ゾーンへの通信が既定で すべて拒否 です。",
      "Internal → IoT も既定で拒否されるので、ポリシー一覧 に Internal → IoT の 許可ポリシーを追加します。",
      "許可ポリシーの戻り通信は自動で許可されます (Stateful)。このシミュレーターは往路のみ判定します。",
    ],
    scenario: () => {
      const { gw, sw, ap, links } = baseTopology("home");
      setPort(sw, 4, access("iot"));
      setPort(sw, 5, access("iot"));
      return {
        networks: [network("lan", "Default", 1, 1), network("iot", "IoT", 30, 30)],
        zones: zones(),
        devices: [gw, sw, ap],
        links,
        ssids: [ssid("home", "Home", "lan", { security: "wpa3" })],
        clients: [wired("pc", "Desktop PC", "pc", sw, 2), wired("plug", "Smart Plug", "iot", sw, 4), wired("cam", "IP Camera", "iot", sw, 5)],
        policies: [],
      };
    },
    checks: [
      { label: "PC → Smart Plug (TCP/80)", query: q("pc", "plug", "tcp", 80), expect: true },
      { label: "Smart Plug → PC (TCP/445) が遮断", query: q("plug", "pc", "tcp", 445), expect: false },
      { label: "IP Camera → PC (ICMP) が遮断", query: q("cam", "pc"), expect: false },
      { label: "IP Camera → インターネット", query: q("cam", "internet", "tcp", 443), expect: true },
      { label: "PC → インターネット", query: q("pc", "internet"), expect: true },
    ],
  },
  {
    id: "trunk-fix",
    title: "VLAN が届かない",
    level: 2,
    summary: "スイッチ間・AP 上流で VLAN が通っていない原因を探して直す",
    story:
      "オフィスに 2 台目のスイッチを増設しました。それ以来、増設スイッチにつないだ社員 PC がネットに出られず、ゲスト WiFi の端末も IP アドレスを取れないと苦情が来ています。",
    goals: [
      "Staff Laptop (増設スイッチ) がインターネットに出られる",
      "Staff Laptop から Printer に印刷 (TCP/9100) できる",
      "Guest Phone がインターネットに出られる",
      "ゲストから Printer には届かない",
    ],
    concepts: ["trunk", "native", "tagged"],
    hints: [
      "パケットトレース で各端末を試すと、どのスイッチのどのポートで止まっているかが表示されます。",
      "Core Switch の Port 8 (AP 向け) は タグ付き VLAN の管理 が 「カスタム」で、Guest が含まれていません。",
      "Core Switch Port 7 と Branch Switch Port 1 は同じケーブルの両端です。ネイティブ VLAN と タグ付き VLAN を両端で揃えます。",
    ],
    scenario: () => {
      const gw = setPort(makeDevice("gateway", "gw", "Gateway"), 1, trunk("lan", "all"));
      const sw1 = setPort(makeDevice("switch", "sw1", "Core Switch"), 1, trunk("lan", "all"));
      setPort(sw1, 7, trunk("lan", ["staff"]));
      setPort(sw1, 8, trunk("lan", ["staff"]));
      const sw2 = setPort(makeDevice("switch", "sw2", "Branch Switch"), 1, access("staff"));
      setPort(sw2, 3, access("staff"));
      setPort(sw2, 4, access("lan"));
      const ap = setPort(makeDevice("ap", "ap1", "Office AP"), 1, trunk("lan", "all"));
      return {
        networks: [network("lan", "Default", 1, 1), network("staff", "Staff", 10, 10), network("guest", "Guest", 20, 20, { zoneId: "hotspot" })],
        zones: zones(),
        devices: [gw, sw1, sw2, ap],
        links: [link(gw, 1, sw1, 1), link(sw1, 7, sw2, 1), link(sw1, 8, ap, 1)],
        ssids: [ssid("staff", "Office", "staff", { security: "wpa3" }), ssid("guest", "Office-Guest", "guest", { clientIsolation: true })],
        clients: [
          wired("laptop", "Staff Laptop", "pc", sw2, 3),
          wired("printer", "Printer", "printer", sw2, 4, "192.168.1.20"),
          wifi("staff-phone", "Staff Phone", "phone", ap, "staff"),
          wifi("guest-phone", "Guest Phone", "phone", ap, "guest"),
        ],
        policies: [],
      };
    },
    checks: [
      { label: "Staff Laptop → インターネット", query: q("laptop", "internet"), expect: true },
      { label: "Staff Laptop → Printer (TCP/9100)", query: q("laptop", "printer", "tcp", 9100), expect: true },
      { label: "Staff Phone → インターネット", query: q("staff-phone", "internet"), expect: true },
      { label: "Guest Phone → インターネット", query: q("guest-phone", "internet"), expect: true },
      { label: "Guest Phone → Printer が遮断", query: q("guest-phone", "printer", "tcp", 9100), expect: false },
    ],
  },
  {
    id: "rule-order",
    title: "ポリシーの順序",
    level: 3,
    summary: "上から順に評価されるポリシーの並びを直す",
    story:
      "ゲストには Web (HTTPS) とプリンター (IPP: TCP/631) だけを使わせたいと考えてポリシーを作りました。ところがゲストは Web もプリンターも使えなくなってしまいました。",
    goals: ["ゲスト → インターネット (TCP/443) は届く", "ゲスト → インターネット (TCP/25) は届かない", "ゲスト → Printer (TCP/631) は届く", "ゲスト → Desktop PC (TCP/445) は届かない"],
    concepts: ["policy", "rule-order"],
    hints: [
      "ポリシーは ポリシー一覧 の上から順に評価され、最初に一致したもので結果が決まります。",
      "ポリシー一覧 の警告に「完全に覆われて評価されない」ポリシーが出ていませんか？",
      "広い 拒否ポリシーは具体的な 許可ポリシーの下に移動します。",
      "Hotspot → Internal は既定で すべて拒否 なので、「Block Guest to LAN」は実は不要です。",
    ],
    scenario: () => {
      const { gw, sw, ap, links } = baseTopology("home");
      return {
        networks: [network("lan", "Default", 1, 1), network("guest", "Guest", 20, 20, { zoneId: "hotspot" })],
        zones: zones(),
        devices: [gw, sw, ap],
        links,
        ssids: [ssid("home", "Home", "lan", { security: "wpa3" }), ssid("guest", "Guest", "guest", { clientIsolation: true })],
        clients: [
          wired("pc", "Desktop PC", "pc", sw, 2),
          wired("printer", "Printer", "printer", sw, 3, "192.168.1.20"),
          wifi("guest-phone", "Guest Phone", "phone", ap, "guest"),
        ],
        policies: [
          policy("p-block-lan", "Block Guest to LAN", "block", "hotspot", "internal"),
          policy("p-ipp", "Allow Guest Printing", "allow", "hotspot", "internal", { dst: "lan", protocol: "tcp", port: 631 }),
          policy("p-block-wan", "Block Guest Internet", "block", "hotspot", "external"),
          policy("p-https", "Allow Guest HTTPS", "allow", "hotspot", "external", { protocol: "tcp", port: 443 }),
        ],
      };
    },
    checks: [
      { label: "Guest Phone → インターネット (TCP/443)", query: q("guest-phone", "internet", "tcp", 443), expect: true },
      { label: "Guest Phone → インターネット (TCP/25) が遮断", query: q("guest-phone", "internet", "tcp", 25), expect: false },
      { label: "Guest Phone → Printer (TCP/631)", query: q("guest-phone", "printer", "tcp", 631), expect: true },
      { label: "Guest Phone → Desktop PC (TCP/445) が遮断", query: q("guest-phone", "pc", "tcp", 445), expect: false },
      { label: "Desktop PC → インターネット", query: q("pc", "internet"), expect: true },
    ],
  },
];

const byId = new Map([...CORE, ...EXTRA, ...PHASE_ONE, ...PHASE_THREE].map((l) => [l.id, l]));

/** 難易度順の課題一覧 */
export const LESSONS: Lesson[] = [
  "home-lan",
  "dhcp-pool",
  "static-ip",
  "wifi-change",
  "guest-wifi",
  "ap-groups",
  "printer-pc",
  "stale-lease",
  "cabling",
  "iot-vlan",
  "mdns-cast",
  "trunk-fix",
  "cctv",
  "ha-only",
  "iot-return",
  "kids-night",
  "switch-loop",
  "poe-budget",
  "rule-order",
  "final",
].map((id) => byId.get(id)!);
