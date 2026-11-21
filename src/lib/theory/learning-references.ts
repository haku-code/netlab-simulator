type Reference = { label: string; href: string };

const rfc = (number: number): Reference => ({ label: `RFC ${number}`, href: `https://datatracker.ietf.org/doc/rfc${number}/` });
const ethernet: Reference = { label: "IEEE 802.3", href: "https://standards.ieee.org/ieee/802.3/10422/" };
const bridging: Reference = { label: "IEEE 802.1Q", href: "https://standards.ieee.org/ieee/802.1q/10323/" };

export const LEARNING_REFERENCES: Record<string, { sources?: Reference[]; practice?: Reference }> = {
  ieee: { sources: [{ label: "IEEE 802 規格委員会", href: "https://ieee802.org/" }] },
  ietf: { sources: [{ label: "IETF の RFC 案内", href: "https://www.ietf.org/process/rfcs/" }] },
  rfc: { sources: [{ label: "IETF の RFC 案内", href: "https://www.ietf.org/process/rfcs/" }] },
  ethernet: { sources: [ethernet], practice: { label: "入門実習でケーブルを抜き差し", href: "/learn" } },
  wifi: { sources: [{ label: "IEEE 802.11", href: "https://www.ieee802.org/11/abt80211.html" }], practice: { label: "SSID と周波数帯を見る", href: "/settings/wifi" } },
  vlan: { sources: [bridging], practice: { label: "VLAN の初級課題を見る", href: "/lessons" } },
  tagged: { sources: [bridging], practice: { label: "キャプチャで VLAN タグを見る", href: "/theory?unit=capture" } },
  stp: { sources: [bridging], practice: { label: "スイッチを輪につないで試す", href: "/theory?unit=stp" } },
  poe: { sources: [ethernet], practice: { label: "ポートの給電設定を見る", href: "/ports" } },
  "802.1x": { sources: [{ label: "IEEE 802.1X", href: "https://standards.ieee.org/ieee/802.1X/7345/" }], practice: { label: "Wi-Fi の認証方式を見る", href: "/settings/wifi" } },
  radius: { sources: [rfc(2865)], practice: { label: "WPA Enterprise の設定を見る", href: "/settings/wifi" } },
  ip: { sources: [rfc(8200)], practice: { label: "基礎理論で IP を見る", href: "/theory?unit=osi" } },
  ndp: { sources: [rfc(4861)], practice: { label: "IPv6 のパケットを追う", href: "/diagnostics" } },
  osi: { practice: { label: "通信をレイヤー別に見る", href: "/theory?unit=osi" } },
  trace: { practice: { label: "パケットトレースを開く", href: "/diagnostics" } },
  qos: { practice: { label: "回線の優先度設定を見る", href: "/settings/qos" } },
  vpn: { practice: { label: "拠点間 VPN の設定を見る", href: "/settings/routing" } },
  dhcp: { sources: [rfc(2131)], practice: { label: "アドレスをもらう手順を見る", href: "/theory?unit=dhcp" } },
  dns: { sources: [rfc(1034)], practice: { label: "DNS が名前を調べる手順を見る", href: "/theory?unit=dns" } },
  arp: { sources: [rfc(826)], practice: { label: "同じ LAN で相手を探す手順を見る", href: "/theory?unit=arp" } },
  tcp: { sources: [rfc(9293)], practice: { label: "TCP の接続開始を見る", href: "/theory?unit=tcp" } },
  udp: { sources: [rfc(768)], practice: { label: "パケットトレースで UDP を選ぶ", href: "/diagnostics" } },
  https: { sources: [rfc(9110), rfc(8446)], practice: { label: "端末のブラウザで試す", href: "/clients" } },
  "ids-ips": { practice: { label: "検知と遮断を試す", href: "/settings/security" } },
};
