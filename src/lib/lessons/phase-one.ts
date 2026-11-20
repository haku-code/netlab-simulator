import { access, network, policy, setPort, ssid, wifi, wired, zones } from "../scenarios/builders";
import { baseTopology, q } from "./helpers";
import type { Lesson } from "./index";

export const PHASE_ONE: Lesson[] = [
  {
    id: "iot-return",
    title: "IoT を止めたら PC から操作できなくなった",
    level: 2,
    summary: "IoT からの新規接続を拒否しながら、PC への応答を通す",
    story: "IoT ゾーンから家庭用 LAN への通信を一律に拒否したところ、Desktop PC から Smart Plug の操作画面にもつながらなくなりました。",
    goals: ["PC から Smart Plug の操作画面（TCP/80）を開ける", "Smart Plug から PC への新規通信は引き続き遮断する"],
    concepts: ["firewall", "stateful"],
    firstSteps: ["パケットトレースで Desktop PC → Smart Plug の TCP/80 を調べ、行きと戻りの判定を読み比べましょう。"],
    hints: [
      "パケットトレースで「戻りの通信が Policy … でブロック」と表示されていませんか？",
      "設定 → ファイアウォール → ポリシー一覧で「IoT から LAN への通信を拒否」を開きます。",
      "拒否ポリシーの「接続状態」を「新規の接続のみ」にすると、PC が始めた通信の応答は通ります。",
    ],
    scenario: () => {
      const { gw, sw, ap, links } = baseTopology("home");
      setPort(sw, 3, access("iot"));
      return {
        networks: [network("lan", "Default", 1, 1), network("iot", "IoT", 30, 30, { zoneId: "iot" })],
        zones: zones({ id: "iot", name: "IoT" }),
        devices: [gw, sw, ap],
        links,
        ssids: [],
        clients: [wired("pc", "Desktop PC", "pc", sw, 2), wired("plug", "Smart Plug", "iot", sw, 3)],
        policies: [
          policy("allow-control", "PC から Smart Plug の操作を許可", "allow", "internal", "iot", { src: "client:pc", dst: "client:plug", protocol: "tcp", port: 80 }),
          policy("block-iot", "IoT から LAN への通信を拒否", "block", "iot", "internal"),
        ],
      };
    },
    checks: [
      { label: "Desktop PC → Smart Plug（TCP/80）", query: q("pc", "plug", "tcp", 80), expect: true },
      { label: "Smart Plug → Desktop PC の新規通信を遮断", query: q("plug", "pc", "tcp", 80), expect: false },
    ],
  },
  {
    id: "kids-night",
    title: "子どもの端末は夜だけ禁止",
    level: 2,
    summary: "端末グループと曜日・時刻を使ってインターネット接続を制限する",
    story: "子どものスマホと PC は毎日 22:00 から翌朝 06:00 までインターネット接続を止めたいです。昼間や家庭内の通信、保護者の PC は普段どおり使えるようにします。",
    goals: [
      "子どものスマホと PC のインターネット接続を毎日 22:00〜翌朝 06:00 に遮断する",
      "子どもの端末は昼間にインターネットへ出られ、夜間も家庭内では通信できる",
      "保護者 PC は夜もインターネットへ出られる",
    ],
    concepts: ["policy", "policy-object", "policy-schedule"],
    firstSteps: ["パケットトレースのシミュレーション時刻を 23:00 に変え、子どもの端末からインターネットへの疎通を確認しましょう。"],
    hints: [
      "設定 → ファイアウォール → オブジェクトで「端末グループ」を作り、子どものスマホと PC を選びます。",
      "ポリシー一覧で Internal → External の拒否ポリシーを作り、送信元の対象に作成したグループを選びます。",
      "スケジュールを「指定する」にし、全曜日の 22:00〜06:00 を選びます。判定は画面の現在時刻にかかわらず、複数の時刻を確認します。",
    ],
    scenario: () => {
      const { gw, sw, ap, links } = baseTopology("home");
      return {
        networks: [network("lan", "Default", 1, 1)],
        zones: zones(),
        devices: [gw, sw, ap],
        links,
        ssids: [ssid("home", "Home", "lan")],
        clients: [
          wired("parent", "保護者 PC", "pc", sw, 2),
          wired("kid-pc", "子どもの PC", "pc", sw, 3),
          wifi("kid-phone", "子どものスマホ", "phone", ap, "home"),
        ],
        policies: [],
      };
    },
    checks: [
      { label: "月曜 21:59 · 子どものスマホはインターネットに接続できる", query: q("kid-phone", "internet", "tcp", 443), expect: true, clock: { day: 1, time: "21:59" } },
      { label: "月曜 22:00 · 子どものスマホのインターネット接続を遮断", query: q("kid-phone", "internet", "tcp", 443), expect: false, clock: { day: 1, time: "22:00" } },
      { label: "火曜 05:59 · 子どもの PC のインターネット接続を遮断", query: q("kid-pc", "internet", "tcp", 443), expect: false, clock: { day: 2, time: "05:59" } },
      { label: "火曜 06:00 · 子どもの PC はインターネットに接続できる", query: q("kid-pc", "internet", "tcp", 443), expect: true, clock: { day: 2, time: "06:00" } },
      { label: "土曜 23:00 · 子どものスマホのインターネット接続を遮断", query: q("kid-phone", "internet", "tcp", 443), expect: false, clock: { day: 6, time: "23:00" } },
      { label: "土曜 23:00 · 保護者 PC はインターネットに接続できる", query: q("parent", "internet", "tcp", 443), expect: true, clock: { day: 6, time: "23:00" } },
      { label: "土曜 23:00 · 子どものスマホから保護者 PC に届く", query: q("kid-phone", "parent"), expect: true, clock: { day: 6, time: "23:00" } },
    ],
  },
];
