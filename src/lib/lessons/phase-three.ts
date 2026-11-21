import { access, link, makeDevice, network, setPort, ssid, trunk, wifi, wired, zones } from "../scenarios/builders";
import { q } from "./helpers";
import type { Lesson } from "./index";

export const PHASE_THREE: Lesson[] = [
  {
    id: "switch-loop",
    title: "ケーブルを 2 本つないだら全部止まった",
    level: 2,
    summary: "スイッチ間のループで起きたブロードキャストストームを STP か LAG で解消する",
    story:
      "書斎のスイッチが遅いので、Core Switch との間に LAN ケーブルをもう 1 本追加しました。すると家じゅうの有線端末が通信できなくなりました。どちらのスイッチもスパニングツリー (STP) が無効になっています。",
    goals: ["書斎の PC がインターネットに出られる", "書斎の PC から NAS に届く", "2 本のケーブルはつないだままにする"],
    concepts: ["stp", "loop", "lag"],
    firstSteps: ["トポロジーで Core Switch と Study Switch の間の線を確認し、パケットトレースで PC → NAS を試しましょう。"],
    hints: [
      "パケットトレースに「ブロードキャストストーム」と出ていませんか？ スイッチ同士を 2 本でつなぐと輪（ループ）になります。",
      "デバイス → Core Switch → 設定で「スパニングツリー (STP)」を有効にすると、片方のポートがブロックされてループが止まります。",
      "2 本とも使いたいなら、両方のスイッチのポート 2・3 を同じ LAG にまとめます（ポートマネージャー → ポート → リンクアグリゲーション）。",
    ],
    scenario: () => {
      const gw = setPort(makeDevice("gateway", "gw", "Gateway"), 1, trunk("lan", "all"));
      const core = makeDevice("switch", "sw1", "Core Switch");
      const study = makeDevice("switch", "sw2", "Study Switch");
      for (const sw of [core, study]) {
        sw.stp = { enabled: false, priority: 32768 };
        for (let i = 1; i <= 8; i++) setPort(sw, i, i <= 3 ? trunk("lan", "all") : access("lan"));
      }
      return {
        networks: [network("lan", "Default", 1, 1)],
        zones: zones(),
        devices: [gw, core, study],
        links: [link(gw, 1, core, 1), link(core, 2, study, 2), link(core, 3, study, 3)],
        ssids: [],
        clients: [wired("pc", "書斎の PC", "pc", study, 5), wired("nas", "NAS", "server", core, 5, "192.168.1.5")],
        policies: [],
      };
    },
    checks: [
      { label: "書斎の PC → インターネット", query: q("pc", "internet"), expect: true },
      { label: "書斎の PC → NAS", query: q("pc", "nas"), expect: true },
      { label: "NAS → インターネット", query: q("nas", "internet"), expect: true },
    ],
  },
  {
    id: "poe-budget",
    title: "防犯カメラが 1 台だけ起動しない",
    level: 2,
    summary: "PoE の電力予算を確認し、不要な給電を止めてカメラに電力を回す",
    story:
      "小さな店舗の PoE スイッチ（電力予算 60 W）に AP 2 台、防犯カメラ 2 台、飾り用の PoE 照明をつないでいます。照明を追加してから、ポート番号の大きい防犯カメラ 2 が起動しなくなりました。",
    goals: ["防犯カメラ 1・2 の映像が録画サーバーに届く", "店舗の Wi-Fi は 2 台の AP とも使える"],
    concepts: ["poe"],
    firstSteps: ["ポートマネージャーで PoE Switch を開き、各ポートの消費電力と電力予算を確認しましょう。"],
    hints: [
      "PoE スイッチはポート番号の小さい順に電力を割り当て、予算を超えたポートには給電しません。",
      "照明（25 W）の給電を止めれば、AP 2 台とカメラ 2 台の合計 42 W に収まります。",
      "ポートマネージャーで照明がつながるポートを開き、PoE を「オフ」にして適用します。",
    ],
    scenario: () => {
      const gw = setPort(makeDevice("gateway", "gw", "Gateway"), 1, trunk("lan", "all"));
      const sw = makeDevice("switch", "sw1", "PoE Switch");
      sw.model = "Switch 8 PoE (60 W)";
      sw.poeBudgetW = 60;
      setPort(sw, 1, trunk("lan", "all"));
      setPort(sw, 2, access("lan"));
      setPort(sw, 3, trunk("lan", "all"));
      setPort(sw, 4, trunk("lan", "all"));
      for (let i = 5; i <= 8; i++) setPort(sw, i, access("lan"));
      const ap1 = setPort(makeDevice("ap", "ap1", "店内 AP"), 1, trunk("lan", "all"));
      const ap2 = setPort(makeDevice("ap", "ap2", "倉庫 AP"), 1, trunk("lan", "all"));
      return {
        networks: [network("lan", "Default", 1, 1)],
        zones: zones(),
        devices: [gw, sw, ap1, ap2],
        links: [link(gw, 1, sw, 1), link(sw, 3, ap1, 1), link(sw, 4, ap2, 1)],
        ssids: [ssid("shop", "Shop", "lan")],
        clients: [
          { ...wired("light", "PoE 照明", "iot", sw, 2), poeW: 25 },
          { ...wired("cam1", "防犯カメラ 1", "iot", sw, 5), poeW: 8 },
          { ...wired("cam2", "防犯カメラ 2", "iot", sw, 6), poeW: 8 },
          wired("nvr", "録画サーバー", "server", sw, 8, "192.168.1.20"),
          wifi("tablet", "レジのタブレット", "phone", ap1, "shop"),
        ],
        policies: [],
      };
    },
    checks: [
      { label: "防犯カメラ 1 → 録画サーバー (TCP/554)", query: q("cam1", "nvr", "tcp", 554), expect: true },
      { label: "防犯カメラ 2 → 録画サーバー (TCP/554)", query: q("cam2", "nvr", "tcp", 554), expect: true },
      { label: "レジのタブレット → インターネット", query: q("tablet", "internet"), expect: true },
    ],
  },
];
