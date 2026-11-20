// サブネット計算ドリルの問題生成と採点
import { inSubnet, ipToStr, maskStr, parseCidr, parseIp } from "../net/ip";

export type DrillKind = "network" | "broadcast" | "hosts" | "range" | "mask" | "prefixForHosts" | "sameSubnet";

export interface DrillQuestion {
  kind: DrillKind;
  prompt: string;
  /** 正解（文字列で比較） */
  answer: string;
  /** 選択式の場合の選択肢 */
  choices?: string[];
  placeholder?: string;
  explain: string[];
}

export const DRILL_LABEL: Record<DrillKind, string> = {
  network: "ネットワークアドレス",
  broadcast: "ブロードキャストアドレス",
  hosts: "ホスト数",
  range: "ホストの範囲",
  mask: "サブネットマスク",
  prefixForHosts: "必要なプレフィックス長",
  sameSubnet: "同じサブネット？",
};

export const toBinary = (ip: string) =>
  ip
    .split(".")
    .map((o) => Number(o).toString(2).padStart(8, "0"))
    .join(".");

function rand(n: number, r: () => number) {
  return Math.floor(r() * n);
}

function randomIp(r: () => number) {
  const first = [10, 172, 192][rand(3, r)];
  const second = first === 192 ? 168 : first === 172 ? 16 + rand(16, r) : rand(256, r);
  return `${first}.${second}.${rand(256, r)}.${1 + rand(254, r)}`;
}

const hostCount = (prefix: number) => (prefix >= 31 ? 2 ** (32 - prefix) : 2 ** (32 - prefix) - 2);

export function makeQuestion(kind: DrillKind, r: () => number = Math.random): DrillQuestion {
  const prefix = 16 + rand(15, r); // /16〜/30
  const ip = randomIp(r);
  const sn = parseCidr(`${ip}/${prefix}`)!;
  const net = ipToStr(sn.network);
  const bc = ipToStr(sn.broadcast);
  const mask = maskStr(prefix);
  const andExplain = [
    `IP     ${toBinary(ip)}  (${ip})`,
    `マスク ${toBinary(mask)}  (/${prefix} = 先頭 ${prefix} ビットが 1)`,
    `AND    ${toBinary(net)}  → ネットワークアドレス ${net}`,
  ];

  switch (kind) {
    case "network":
      return { kind, prompt: `${ip}/${prefix} のネットワークアドレスは？`, answer: net, placeholder: "例: 192.168.1.0", explain: [...andExplain, "IP とサブネットマスクの AND をとると、ホスト部が 0 になります。"] };
    case "broadcast":
      return {
        kind,
        prompt: `${ip}/${prefix} のブロードキャストアドレスは？`,
        answer: bc,
        placeholder: "例: 192.168.1.255",
        explain: [...andExplain, `ホスト部 (${32 - prefix} ビット) をすべて 1 にする → ${bc}`],
      };
    case "hosts":
      return {
        kind,
        prompt: `/${prefix} のサブネットで、ホストに割り当てられるアドレスはいくつ？`,
        answer: String(hostCount(prefix)),
        placeholder: "数字",
        explain: [`ホスト部は 32 − ${prefix} = ${32 - prefix} ビット`, `2^${32 - prefix} = ${2 ** (32 - prefix)} 個から、ネットワークアドレスとブロードキャストの 2 つを引く → ${hostCount(prefix)}`],
      };
    case "range":
      return {
        kind,
        prompt: `${ip}/${prefix} で使えるホストアドレスの範囲は？（最初 - 最後）`,
        answer: `${ipToStr(sn.network + 1)} - ${ipToStr(sn.broadcast - 1)}`,
        placeholder: "例: 192.168.1.1 - 192.168.1.254",
        explain: [...andExplain, `ブロードキャスト ${bc}`, `最初のホスト = ネットワーク + 1、最後のホスト = ブロードキャスト − 1`],
      };
    case "mask":
      return { kind, prompt: `/${prefix} をドット区切りのサブネットマスクで書くと？`, answer: mask, placeholder: "例: 255.255.255.0", explain: [`先頭 ${prefix} ビットが 1: ${toBinary(mask)}`, `8 ビットずつ 10 進数に直す → ${mask}`] };
    case "prefixForHosts": {
      const need = 2 + rand(2000, r);
      let p = 30;
      while (hostCount(p) < need) p--;
      return {
        kind,
        prompt: `ホストが ${need} 台入るサブネットを作りたい。最も小さいサブネット（プレフィックス長が最大）は /いくつ？`,
        answer: String(p),
        placeholder: "例: 24",
        explain: [`/${p} のホスト数は ${hostCount(p)}（≥ ${need}）`, `/${p + 1} だと ${hostCount(p + 1)} で足りない`, "2^ホストビット − 2 ≥ 必要台数 となる最小のホストビットを探します。"],
      };
    }
    case "sameSubnet": {
      const other = r() < 0.5 ? ipToStr(sn.network + 1 + rand(Math.max(1, sn.size - 2), r)) : ipToStr((sn.broadcast + 1 + rand(512, r)) >>> 0);
      const same = inSubnet(parseIp(other)!, sn);
      return {
        kind,
        prompt: `${ip}/${prefix} と ${other} は同じサブネット？`,
        answer: same ? "同じ" : "違う",
        choices: ["同じ", "違う"],
        explain: [...andExplain, `${other} の範囲 ${net} 〜 ${bc} に${same ? "入る" : "入らない"}`, same ? "同じサブネットなのでルーターを通らずに直接届きます。" : "別のサブネットなのでデフォルトゲートウェイに送られます。"],
      };
    }
  }
}

/** 入力の表記ゆれ（空白・"/"・全角）を吸収して比較 */
export function checkAnswer(q: DrillQuestion, input: string) {
  const norm = (v: string) =>
    v
      .normalize("NFKC")
      .replace(/^\//, "")
      .replace(/\s*[-〜~]\s*/g, " - ")
      .trim();
  return norm(input) === norm(q.answer);
}
