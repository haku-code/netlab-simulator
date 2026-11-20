import type { Client } from "../model";
import { access, link, makeDevice, network, policy, setPort, ssid, trunk, wifi, wired, zones } from "../scenarios/builders";
import { CAST_TYPES, PRINT_TYPES } from "../mdns";
import { baseTopology, q } from "./helpers";
import type { Lesson } from "./index";

const unplug = (c: Client) => {
  c.connection = { type: "wired", deviceId: null, portId: null };
  return c;
};

export const EXTRA: Lesson[] = [
  {
    id: "dhcp-pool",
    title: "端末が増えたらつながらない",
    level: 1,
    summary: "DHCP の範囲が狭すぎて、後から来た端末が IP をもらえない",
    story: "オフィスに PC を増やしたところ、新しく来た 2 台だけインターネットに出られません。最初からある 3 台は問題なく使えています。",
    goals: ["5 台すべてがインターネットに出られる"],
    concepts: ["dhcp", "subnet"],
    firstSteps: ["New PC 1 の端末を開き、ネットワーク設定の IP アドレスを確認する（169.254.x.x は DHCP 失敗のしるし）"],
    hints: [
      "クライアント一覧で「IP 未取得」になっている端末を確認しましょう。",
      "設定 → ネットワーク > Default の DHCP の割り当て範囲 は 3 アドレスしかありません。",
      "/24 のサブネットなら .1〜.254 が使えます。範囲を例えば 192.168.1.6〜192.168.1.254 に広げると、待っていた端末が自動で IP を取り直します。",
    ],
    scenario: () => {
      const { gw, sw, ap, links } = baseTopology();
      return {
        networks: [network("lan", "Default", 1, 1, { dhcp: { enabled: true, start: "192.168.1.100", end: "192.168.1.102" } })],
        zones: zones(),
        devices: [gw, sw, ap],
        links,
        ssids: [ssid("home", "Office", "lan")],
        clients: [
          wired("pc1", "Office PC A", "pc", sw, 2),
          wired("pc2", "Office PC B", "pc", sw, 3),
          wifi("phone", "Manager Phone", "phone", ap, "home"),
          wired("new1", "New PC 1", "pc", sw, 4),
          wired("new2", "New PC 2", "pc", sw, 5),
        ],
        policies: [],
      };
    },
    checks: ["pc1", "pc2", "phone", "new1", "new2"].map((id) => ({ label: `${id === "phone" ? "Manager Phone" : id.startsWith("new") ? `New PC ${id.slice(3)}` : `Office PC ${id === "pc1" ? "A" : "B"}`} → インターネット`, query: q(id, "internet"), expect: true })),
  },
  {
    id: "static-ip",
    title: "固定 IP の設定ミス",
    level: 1,
    summary: "IP の重複と、古いルーターのサブネットのまま残った固定 IP を直す",
    story:
      "ルーターを入れ替えたあと、プリンターと防犯カメラにつながらなくなりました。どちらも固定 IP で設定してあります。NAS は問題なく使えています。DHCP の範囲は .100〜.200 です。",
    goals: ["PC → NAS (TCP/445)", "PC → Printer で印刷 (TCP/631)", "PC → Camera の管理画面 (TCP/80)"],
    concepts: ["subnet", "dhcp"],
    firstSteps: ["Desktop PC のブラウザで 192.168.1.20（プリンター）と 192.168.0.50（カメラ）を開いてみる"],
    hints: [
      "クライアント一覧のステータスと「学習用: 原因を見る」を確認しましょう。",
      "Printer の固定 IP は NAS と重複しています。DHCP 範囲 (.100〜.200) の外で、空いているアドレスに変えます。",
      "Camera の 192.168.0.50 は以前のルーターのサブネットです。192.168.1.x に変えます（端末の「設定」 または端末エミュレーターのネットワーク設定）。",
    ],
    scenario: () => {
      const { gw, sw, ap, links } = baseTopology("home");
      return {
        networks: [network("lan", "Default", 1, 1, { dhcp: { enabled: true, start: "192.168.1.100", end: "192.168.1.200" } })],
        zones: zones(),
        devices: [gw, sw, ap],
        links,
        ssids: [ssid("home", "Home", "lan")],
        clients: [
          wired("pc", "Desktop PC", "pc", sw, 2),
          wired("nas", "NAS", "server", sw, 3, "192.168.1.20"),
          wired("printer", "Printer", "printer", sw, 4, "192.168.1.20"),
          wired("cam", "Camera", "iot", sw, 5, "192.168.0.50"),
        ],
        policies: [],
      };
    },
    checks: [
      { label: "Desktop PC → NAS (TCP/445)", query: q("pc", "nas", "tcp", 445), expect: true },
      { label: "Desktop PC → Printer (TCP/631)", query: q("pc", "printer", "tcp", 631), expect: true },
      { label: "Desktop PC → Camera (TCP/80)", query: q("pc", "cam", "tcp", 80), expect: true },
    ],
  },
  {
    id: "wifi-change",
    title: "Wi-Fi の設定を変えたら",
    level: 1,
    summary: "パスワード・セキュリティ方式・周波数帯の変更で切れた端末をつなぎ直す",
    story:
      "セキュリティ強化のため、Wi-Fi「Home」のパスワードを「Sakura-2026」に変更し、方式も WPA3 にしました。ついでに「Home-IoT」は 5 GHz だけで配信するようにしました。すると家中の端末が Wi-Fi から外れてしまいました。",
    goals: ["iPhone・Laptop・Smart TV・Smart Plug がインターネットに出られる"],
    concepts: ["ssid"],
    firstSteps: ["iPhone の端末を開き、設定 > Wi-Fi で新しいパスワードを入力する", "Smart TV の設定画面で Wi-Fi 一覧を見る"],
    hints: [
      "iPhone と Laptop は、端末の Wi-Fi 設定で新しいパスワードを入れ直せばつながります。",
      "Smart TV は WPA3 に対応していません。WPA2 の「Home-IoT」につなぐか、「Home」を WPA2 に戻します。",
      "Smart Plug は 2.4 GHz にしか対応していません。設定 → Wi-Fi で Home-IoT の Wi-Fi 周波数帯 に 2.4 GHz を戻します。",
    ],
    scenario: () => {
      const { gw, sw, ap, links } = baseTopology("home");
      setPort(sw, 8, trunk("lan", "all"));
      return {
        networks: [network("lan", "Default", 1, 1), network("iot", "IoT", 30, 30)],
        zones: zones(),
        devices: [gw, sw, ap],
        links,
        ssids: [
          ssid("home", "Home", "lan", { security: "wpa3", password: "Sakura-2026" }),
          ssid("home-iot", "Home-IoT", "iot", { bands: ["5"] }),
        ],
        clients: [
          wifi("iphone", "iPhone", "phone", ap, "home"),
          wifi("laptop", "Laptop", "pc", ap, "home"),
          wifi("tv", "Smart TV", "tv", ap, "home"),
          wifi("plug", "Smart Plug", "iot", ap, "home-iot"),
        ],
        policies: [],
      };
    },
    checks: [
      { label: "iPhone → インターネット", query: q("iphone", "internet"), expect: true },
      { label: "Laptop → インターネット", query: q("laptop", "internet"), expect: true },
      { label: "Smart TV → インターネット", query: q("tv", "internet", "tcp", 443), expect: true },
      { label: "Smart Plug → インターネット", query: q("plug", "internet", "tcp", 443), expect: true },
    ],
  },
  {
    id: "printer-pc",
    title: "印刷できない（PC から調べる）",
    level: 2,
    summary: "端末側の ping とブラウザから原因に当たりをつけ、スイッチの設定を直す",
    story:
      "「今朝から印刷できない」と連絡がありました。プリンターは固定 IP 192.168.1.20 です。昨日、別の担当者がスイッチのポート設定を触ったそうです。まずは PC から何が起きているか調べてみましょう。",
    goals: ["Desktop PC → Printer で印刷できる (TCP/631 と TCP/9100)"],
    concepts: ["native", "subnet"],
    firstSteps: [
      "Desktop PC のネットワークユーティリティで 192.168.1.20 に ping する（同じサブネットなのに応答がない → ARP が返ってこない）",
      "Printer の端末を開いて前面パネルの表示を見る",
    ],
    hints: [
      "同じサブネット宛ての ping がタイムアウトする場合、その IP の端末が同じ VLAN にいない可能性があります。",
      "ポートマネージャー で Printer がつながっている Core Switch のポートを確認します。ネイティブ VLAN が Office になっていませんか？",
      "ネイティブ VLAN を Default に戻すと、プリンターの固定 IP 192.168.1.20 が正しいサブネットに入ります。",
    ],
    scenario: () => {
      const { gw, sw, ap, links } = baseTopology();
      setPort(sw, 5, access("office"));
      return {
        networks: [network("lan", "Default", 1, 1), network("office", "Office", 10, 10)],
        zones: zones(),
        devices: [gw, sw, ap],
        links,
        ssids: [ssid("home", "Office", "lan")],
        clients: [wired("pc", "Desktop PC", "pc", sw, 2), wired("printer", "Printer", "printer", sw, 5, "192.168.1.20")],
        policies: [],
      };
    },
    checks: [
      { label: "Desktop PC → Printer (TCP/631)", query: q("pc", "printer", "tcp", 631), expect: true },
      { label: "Desktop PC → Printer (TCP/9100)", query: q("pc", "printer", "tcp", 9100), expect: true },
    ],
  },
  {
    id: "stale-lease",
    title: "VLAN を変えたのに",
    level: 2,
    summary: "ポートの VLAN を変えても、端末は古い IP を使い続ける",
    story:
      "経理の Laptop を Staff VLAN に移すため、Port 4 の ネイティブ VLAN を Staff に変更しました。ところが Laptop はファイルサーバーにもインターネットにもつながりません。スイッチの設定は正しいはずです。",
    goals: ["Laptop → File Server (TCP/445)", "Laptop → インターネット"],
    concepts: ["dhcp", "vlan"],
    firstSteps: ["Laptop の端末を開き、ネットワーク設定の IP とルーターを確認する"],
    hints: [
      "Laptop の IP は 192.168.1.x のままです。ケーブルが挿さったままなので、端末は VLAN が変わったことに気づいていません。",
      "端末のネットワーク設定で「DHCP リースを更新」を押すか、ポートマネージャー でケーブルを抜き挿しします。",
    ],
    scenario: () => {
      const { gw, sw, ap, links } = baseTopology();
      setPort(sw, 4, access("staff"));
      setPort(sw, 5, access("staff"));
      const laptop = wired("laptop", "Laptop", "pc", sw, 4);
      laptop.lease = { ip: "192.168.1.30", networkId: "lan" };
      return {
        networks: [network("lan", "Default", 1, 1), network("staff", "Staff", 10, 10)],
        zones: zones(),
        devices: [gw, sw, ap],
        links,
        ssids: [ssid("home", "Office", "lan")],
        clients: [laptop, wired("fs", "File Server", "server", sw, 5, "192.168.10.5"), wired("pc", "Reception PC", "pc", sw, 2)],
        policies: [],
      };
    },
    checks: [
      { label: "Laptop → File Server (TCP/445)", query: q("laptop", "fs", "tcp", 445), expect: true },
      { label: "Laptop → インターネット", query: q("laptop", "internet"), expect: true },
    ],
  },
  {
    id: "cabling",
    title: "配線ミスを探せ",
    level: 2,
    summary: "抜けたケーブル・無効なポート・挿し間違いを ポートマネージャー で直す",
    story:
      "オフィスの引っ越しで配線をやり直しました。PC はネットに出られず、プリンターは見つからず、ゲスト Wi-Fi の端末は IP を取れません。社員用の Wi-Fi だけは使えます。",
    goals: ["Desktop PC → インターネット", "Desktop PC → Printer (TCP/631)", "Guest Phone → インターネット", "Staff Phone → インターネット"],
    concepts: ["trunk", "access"],
    firstSteps: ["ポートマネージャー で Core Switch の各ポートの LED と接続先を見る"],
    hints: [
      "Printer のケーブルが抜けています。ポートマネージャー の「有線の端末」から空いているポートへドラッグして挿します。",
      "Desktop PC が挿さっている Port 3 は無効化されています（ポートを有効にする）。",
      "AP が Port 6 (すべて拒否) に挿さっているため、ネイティブ VLAN 以外の VLAN (Guest) が AP まで届きません。Port 8 へつなぎ直すか、Port 6 を すべて許可 にします。",
    ],
    scenario: () => {
      const { gw, sw, ap } = baseTopology();
      setPort(sw, 3, { enabled: false });
      return {
        networks: [network("lan", "Default", 1, 1), network("guest", "Guest", 20, 20, { zoneId: "hotspot" })],
        zones: zones(),
        devices: [gw, sw, ap],
        links: [link(gw, 1, sw, 1), link(sw, 6, ap, 1)],
        ssids: [ssid("staff", "Office", "lan", { security: "wpa3" }), ssid("guest", "Office-Guest", "guest", { clientIsolation: true })],
        clients: [
          wired("pc", "Desktop PC", "pc", sw, 3),
          unplug(wired("printer", "Printer", "printer", sw, 4, "192.168.1.20")),
          wifi("staff-phone", "Staff Phone", "phone", ap, "staff"),
          wifi("guest-phone", "Guest Phone", "phone", ap, "guest"),
        ],
        policies: [],
      };
    },
    checks: [
      { label: "Desktop PC → インターネット", query: q("pc", "internet"), expect: true },
      { label: "Desktop PC → Printer (TCP/631)", query: q("pc", "printer", "tcp", 631), expect: true },
      { label: "Guest Phone → インターネット", query: q("guest-phone", "internet"), expect: true },
      { label: "Staff Phone → インターネット", query: q("staff-phone", "internet"), expect: true },
    ],
  },
  {
    id: "cctv",
    title: "防犯カメラのネットワーク",
    level: 3,
    summary: "カメラをインターネットからも PC からも切り離し、録画機 (NVR) だけ許可する",
    story:
      "防犯カメラを 2 台設置し、Cameras VLAN に入れました。でも現状ではカメラが社内のどこにでも、インターネットにもアクセスできます。録画機 (NVR) はカメラの映像 (RTSP: TCP/554) を受け取れる必要があります。",
    goals: [
      "NVR → カメラの映像 (TCP/554) は届く",
      "PC からカメラには映像 (TCP/554) も管理画面 (TCP/80) も届かない",
      "カメラはインターネットに出られない",
      "カメラから社内 (PC) には届かない",
      "PC から NVR の画面 (TCP/5000) は使える",
    ],
    concepts: ["zone", "device-policy", "isolate-network"],
    hints: [
      "設定 → ゾーン でカスタムゾーン「Cameras」を作り、Cameras ネットワークを移します。",
      "Internal → Cameras は既定で拒否されます。TCP/554 を許可するポリシーを作りますが、PC も同じ Default ネットワークにいるので、送信元をネットワークにすると PC まで許可されてしまいます。",
      "ポリシーの 「送信元」で「端末: NVR」を選ぶと、NVR だけを許可できます（端末単位のポリシー）。",
      "カメラのインターネットは、ネットワーク設定の インターネット接続を許可 をオフにするか、Cameras → External の 拒否ポリシーで止めます。",
    ],
    scenario: () => {
      const { gw, sw, ap, links } = baseTopology();
      setPort(sw, 4, access("cams"));
      setPort(sw, 5, access("cams"));
      return {
        networks: [network("lan", "Default", 1, 1), network("cams", "Cameras", 40, 40)],
        zones: zones(),
        devices: [gw, sw, ap],
        links,
        ssids: [ssid("home", "Office", "lan")],
        clients: [
          wired("pc", "Desktop PC", "pc", sw, 2),
          wired("nvr", "NVR", "server", sw, 3, "192.168.1.10"),
          wired("cam1", "Camera Entrance", "iot", sw, 4),
          wired("cam2", "Camera Parking", "iot", sw, 5),
        ],
        policies: [],
      };
    },
    checks: [
      { label: "NVR → Camera Entrance (TCP/554)", query: q("nvr", "cam1", "tcp", 554), expect: true },
      { label: "NVR → Camera Parking (TCP/554)", query: q("nvr", "cam2", "tcp", 554), expect: true },
      { label: "Desktop PC → Camera Entrance (TCP/80) が遮断", query: q("pc", "cam1", "tcp", 80), expect: false },
      { label: "Desktop PC → Camera Entrance の映像 (TCP/554) も遮断", query: q("pc", "cam1", "tcp", 554), expect: false },
      { label: "Camera Entrance → インターネット が遮断", query: q("cam1", "internet", "tcp", 443), expect: false },
      { label: "Camera Parking → Desktop PC が遮断", query: q("cam2", "pc"), expect: false },
      { label: "Desktop PC → NVR (TCP/5000)", query: q("pc", "nvr", "tcp", 5000), expect: true },
      { label: "Desktop PC → インターネット", query: q("pc", "internet"), expect: true },
    ],
  },
  {
    id: "final",
    title: "総合トラブルシュート",
    level: 3,
    summary: "複数の不具合が重なった家庭ネットワークを、症状から一つずつ直す",
    story:
      "知人の家のネットワークを見てほしいと頼まれました。「スマートプラグが動かない」「テレビで動画が見られない」「ゲストの Wi-Fi から家の PC が見えてしまう」「PC からプラグの設定画面が開けない」と言われています。",
    goals: [
      "PC・Smart Plug・Smart TV・Guest Phone がインターネットに出られる",
      "PC → Smart Plug の管理画面 (TCP/80) は開ける",
      "Smart Plug → PC は届かない",
      "Guest Phone → PC は届かない",
    ],
    concepts: ["dhcp", "ssid", "trunk", "zone", "rule-order"],
    firstSteps: ["パケットトレース の到達性マトリクスで全体を眺め、赤いところから順に調べる"],
    hints: [
      "IoT ネットワークの DHCP が無効になっています。",
      "Wi-Fi「Guest」が Default ネットワークにつながっています。Guest ネットワークに直しましょう。",
      "Guest に直すと、今度は AP 上流 (Core Switch Port 8) の カスタム設定に Guest VLAN が無いことに気づくはずです。",
      "ポリシー一覧 で TCP/80 の許可ポリシーが拒否ポリシーの下にあり、評価されていません。",
    ],
    scenario: () => {
      const { gw, sw, ap, links } = baseTopology("home");
      setPort(sw, 4, access("iot"));
      setPort(sw, 8, trunk("lan", ["iot"]));
      return {
        networks: [
          network("lan", "Default", 1, 1),
          network("iot", "IoT", 30, 30, { zoneId: "iot", dhcp: { enabled: false, start: "192.168.30.6", end: "192.168.30.254" } }),
          network("guest", "Guest", 50, 50, { zoneId: "hotspot" }),
        ],
        zones: zones({ id: "iot", name: "IoT" }),
        devices: [gw, sw, ap],
        links,
        ssids: [ssid("home", "Home", "lan", { security: "wpa3" }), ssid("home-iot", "Home-IoT", "iot", { bands: ["2.4"] }), ssid("guest", "Guest", "lan", { clientIsolation: true })],
        clients: [
          wired("pc", "Desktop PC", "pc", sw, 2),
          wired("plug", "Smart Plug", "iot", sw, 4),
          wifi("tv", "Smart TV", "tv", ap, "home-iot"),
          wifi("iphone", "iPhone", "phone", ap, "home"),
          wifi("guest-phone", "Guest Phone", "phone", ap, "guest"),
        ],
        policies: [
          policy("p-block", "Block LAN to IoT", "block", "internal", "iot"),
          policy("p-http", "Allow LAN to IoT (HTTP)", "allow", "internal", "iot", { protocol: "tcp", port: 80 }),
        ],
      };
    },
    checks: [
      { label: "Desktop PC → インターネット", query: q("pc", "internet"), expect: true },
      { label: "Smart Plug → インターネット", query: q("plug", "internet", "tcp", 443), expect: true },
      { label: "Smart TV → インターネット", query: q("tv", "internet", "tcp", 443), expect: true },
      { label: "Guest Phone → インターネット", query: q("guest-phone", "internet", "tcp", 443), expect: true },
      { label: "Desktop PC → Smart Plug (TCP/80)", query: q("pc", "plug", "tcp", 80), expect: true },
      { label: "Smart Plug → Desktop PC が遮断", query: q("plug", "pc"), expect: false },
      { label: "Guest Phone → Desktop PC が遮断", query: q("guest-phone", "pc", "tcp", 445), expect: false },
    ],
  },
  {
    id: "mdns-cast",
    title: "TV にキャストできない",
    level: 2,
    summary: "VLAN を分けると mDNS (AirPlay / Cast / プリンター検出) が届かなくなる",
    story:
      "セキュリティのために TV とプリンターを IoT ゾーンへ移しました。すると iPhone のキャスト一覧から TV が消え、PC のプリンター一覧からもプリンターが消えてしまいました。IoT 機器から家族の端末へのアクセスは引き続き止めておきたいです。",
    goals: [
      "iPhone から Smart TV が見つかり、キャストできる (TCP/8009)",
      "PC から Printer が見つかり、印刷できる (TCP/631)",
      "IoT 機器 → Default の端末へは届かない",
    ],
    concepts: ["mdns", "zone", "policy"],
    firstSteps: ["iPhone の「キャスト」アプリを開き、TV が見つからない理由を「学習用: 原因を見る」で確認する", "PC の「プリンター」アプリも開いてみる"],
    hints: [
      "mDNS はマルチキャストなので、ルーター (ゲートウェイ) を越えて別の VLAN には届きません。",
      "設定 → ネットワーク の ネットワーク共通設定 で マルチキャスト DNS (mDNS) を有効にし、Default と IoT を選びます。",
      "見つかるようになっても、キャスト (TCP/8009) と印刷 (TCP/631) の通信は Internal → IoT のファイアウォールで止まります。必要なポートだけ許可するポリシーを作りましょう。",
    ],
    scenario: () => {
      const { gw, sw, ap, links } = baseTopology("home");
      setPort(sw, 4, access("iot"));
      return {
        networks: [network("lan", "Default", 1, 1), network("iot", "IoT", 30, 30, { zoneId: "iot" })],
        zones: zones({ id: "iot", name: "IoT" }),
        devices: [gw, sw, ap],
        links,
        ssids: [ssid("home", "Home", "lan", { security: "wpa3" }), ssid("home-iot", "Home-IoT", "iot")],
        clients: [
          wired("pc", "Desktop PC", "pc", sw, 2),
          wifi("iphone", "iPhone", "phone", ap, "home"),
          wifi("tv", "Smart TV", "tv", ap, "home-iot"),
          wired("printer", "Printer", "printer", sw, 4, "192.168.30.20"),
        ],
        policies: [],
        mdns: { enabled: false, networkIds: [] },
      };
    },
    checks: [
      { label: "iPhone から Smart TV が見つかる (mDNS)", discover: { srcId: "iphone", targetId: "tv", types: CAST_TYPES }, expect: true },
      { label: "iPhone → Smart TV にキャスト (TCP/8009)", query: q("iphone", "tv", "tcp", 8009), expect: true },
      { label: "Desktop PC から Printer が見つかる (mDNS)", discover: { srcId: "pc", targetId: "printer", types: PRINT_TYPES }, expect: true },
      { label: "Desktop PC → Printer で印刷 (TCP/631)", query: q("pc", "printer", "tcp", 631), expect: true },
      { label: "Smart TV → Desktop PC が遮断", query: q("tv", "pc"), expect: false },
      { label: "Printer → iPhone が遮断", query: q("printer", "iphone"), expect: false },
    ],
  },
  {
    id: "ha-only",
    title: "IoT は Home Assistant 経由だけ",
    level: 3,
    summary: "端末単位のポリシーで、IoT へのアクセスをハブ 1 台に絞る",
    story:
      "スマートホームは Home Assistant サーバーでまとめて操作しています。ところが今は「Default → IoT をすべて許可」のポリシーがあるため、家族の PC やスマホからも IoT 機器を直接触れてしまいます。IoT へのアクセスは Home Assistant だけにしたいです。家族は Home Assistant の画面 (TCP/8123) から操作します。",
    goals: [
      "Home Assistant → Smart Plug (TCP/80) と Camera (TCP/554) は届く",
      "PC・iPhone から IoT 機器へ直接は届かない",
      "iPhone → Home Assistant (TCP/8123) は使える",
      "IoT 機器 → Home Assistant は届かない",
    ],
    concepts: ["device-policy", "policy", "zone"],
    hints: [
      "今のポリシーは Source が「Default」ネットワーク全体なので、PC も iPhone も一致します。",
      "ポリシー一覧 で「Allow LAN to IoT」を開き、「送信元」の ネットワーク / 端末 を「端末: Home Assistant」に変えます。",
      "iPhone → Home Assistant は同じネットワーク内なのでファイアウォールを通りません。",
    ],
    scenario: () => {
      const { gw, sw, ap, links } = baseTopology("home");
      setPort(sw, 4, access("iot"));
      setPort(sw, 5, access("iot"));
      return {
        networks: [network("lan", "Default", 1, 1), network("iot", "IoT", 30, 30, { zoneId: "iot" })],
        zones: zones({ id: "iot", name: "IoT" }),
        devices: [gw, sw, ap],
        links,
        ssids: [ssid("home", "Home", "lan", { security: "wpa3" })],
        clients: [
          wired("pc", "Desktop PC", "pc", sw, 2),
          wired("ha", "Home Assistant", "server", sw, 3, "192.168.1.10"),
          wired("plug", "Smart Plug", "iot", sw, 4),
          wired("cam", "Camera", "iot", sw, 5),
          wifi("iphone", "iPhone", "phone", ap, "home"),
        ],
        policies: [policy("p-lan-iot", "Allow LAN to IoT", "allow", "internal", "iot", { src: "lan" })],
      };
    },
    checks: [
      { label: "Home Assistant → Smart Plug (TCP/80)", query: q("ha", "plug", "tcp", 80), expect: true },
      { label: "Home Assistant → Camera (TCP/554)", query: q("ha", "cam", "tcp", 554), expect: true },
      { label: "Desktop PC → Smart Plug (TCP/80) が遮断", query: q("pc", "plug", "tcp", 80), expect: false },
      { label: "iPhone → Camera (TCP/554) が遮断", query: q("iphone", "cam", "tcp", 554), expect: false },
      { label: "iPhone → Home Assistant (TCP/8123)", query: q("iphone", "ha", "tcp", 8123), expect: true },
      { label: "Smart Plug → Home Assistant が遮断", query: q("plug", "ha"), expect: false },
    ],
  },
  {
    id: "ap-groups",
    title: "会議室だけゲスト Wi-Fi",
    level: 1,
    summary: "配信 AP で、SSID ごとに配信する AP を選ぶ",
    story:
      "オフィスに AP が 2 台あります（執務エリアの Office AP と、会議室の Meeting Room AP）。来客用の Wi-Fi は会議室でだけ使わせたいのに、執務エリアでも見えてしまっています。逆に、社員用の Wi-Fi は会議室だとつながりません。",
    goals: [
      "会議室の来客はゲスト Wi-Fi でインターネットに出られる",
      "執務エリアにいる来客にはゲスト Wi-Fi が見えない（接続できない）",
      "社員は執務エリアでも会議室でも社員用 Wi-Fi が使える",
    ],
    concepts: ["broadcasting", "ssid"],
    firstSteps: ["Lobby Visitor と Meeting Room Staff の端末を開き、Wi-Fi 一覧に何が見えているか比べる"],
    hints: [
      "端末は近くの AP が配信している SSID しか見えません（クライアントの 「アクセスポイント」が端末のいる場所）。",
      "設定 → Wi-Fi で「Office-Guest」の 配信 AP を 「指定した AP」にし、Meeting Room AP だけを選びます。",
      "「Office」(社員用) は Office AP だけになっています。「すべての AP」に戻しましょう。",
    ],
    scenario: () => {
      const { gw, sw, ap, links } = baseTopology();
      const meeting = setPort(makeDevice("ap", "ap2", "Meeting Room AP"), 1, trunk("lan", "all"));
      setPort(sw, 7, trunk("lan", "all"));
      return {
        networks: [network("lan", "Default", 1, 1), network("guest", "Guest", 20, 20, { zoneId: "hotspot" })],
        zones: zones(),
        devices: [gw, sw, ap, meeting],
        links: [...links, link(sw, 7, meeting, 1)],
        ssids: [
          ssid("staff", "Office", "lan", { security: "wpa3", apIds: ["ap1"] }),
          ssid("guest", "Office-Guest", "guest", { clientIsolation: true }),
        ],
        clients: [
          wifi("staff-laptop", "Desk Laptop", "pc", ap, "staff"),
          wifi("staff-phone", "Meeting Room Staff", "phone", meeting, "staff"),
          wifi("visitor-meeting", "Meeting Room Visitor", "phone", meeting, "guest"),
          wifi("visitor-lobby", "Lobby Visitor", "phone", ap, "guest"),
        ],
        policies: [],
      };
    },
    checks: [
      { label: "Meeting Room Visitor → インターネット", query: q("visitor-meeting", "internet", "tcp", 443), expect: true },
      { label: "Lobby Visitor (執務エリア) はゲスト Wi-Fi に接続できない", query: q("visitor-lobby", "internet", "tcp", 443), expect: false },
      { label: "Desk Laptop → インターネット", query: q("staff-laptop", "internet"), expect: true },
      { label: "Meeting Room Staff → インターネット", query: q("staff-phone", "internet"), expect: true },
    ],
  },
];

