import { netInfo, pingLines, probe } from "./emu";
import { useSecurityLog } from "./security-log";
import { LESSONS, runChecks } from "./lessons";
import { findDevice, findNetwork, findPort, resolveClient, trace } from "./net/simulate";
import { validate } from "./net/validate";
import type { useStore } from "./store";
import { portBusy, portPeer, taggedLabel } from "./topo";

export const TERMINAL_ROUTES = [
  { id: "dashboard", href: "/dashboard", label: "ダッシュボード" },
  { id: "topology", href: "/topology", label: "トポロジー" },
  { id: "devices", href: "/devices", label: "デバイス" },
  { id: "ports", href: "/ports", label: "ポートマネージャー" },
  { id: "clients", href: "/clients", label: "クライアント" },
  { id: "diagnostics", href: "/diagnostics", label: "パケットトレース" },
  { id: "lessons", href: "/lessons", label: "学習" },
  { id: "theory", href: "/theory", label: "基礎理論" },
  { id: "settings", href: "/settings/networks", label: "設定" },
] as const;

const SETTINGS_ROUTES = [
  { id: "networks", href: "/settings/networks" },
  { id: "wifi", href: "/settings/wifi" },
  { id: "zones", href: "/settings/zones" },
  { id: "policies", href: "/settings/policies" },
  { id: "internet", href: "/settings/internet" },
];
const ROUTES = [...TERMINAL_ROUTES, ...SETTINGS_ROUTES];
const SHOW = ["clients", "devices", "networks", "ports", "wifi", "issues"];
const LESSON = ["list", "start", "status", "hint", "check", "exit"];
const PORT_ACTIONS = ["enable", "disable", "native", "tagged"];
const TAG_MODES = ["all", "none", "custom"] as const;
const COMMANDS = {
  help: "help                                コマンド一覧",
  shortcuts: "shortcuts                           キーボード操作一覧",
  go: "go <画面>                           画面移動（例: go topology）",
  show: "show <clients|devices|networks|ports|wifi|issues> [ID]  構成・問題の確認",
  ping: "ping <送信元ID> <端末ID|IP|ホスト>   疎通確認（例: ping pc nas）",
  trace: "trace <送信元ID> <端末ID|internet> [icmp|tcp|udp] [ポート]  パケット経路",
  renew: "renew <端末ID>                      DHCP リースの更新",
  plug: "plug <有線端末ID> <機器ID> <ポート番号>  ケーブルの接続・移動",
  unplug: "unplug <有線端末ID>                 ケーブルを抜く",
  port: "port <機器ID> <ポート番号> <enable|disable|native|tagged> [設定値]",
  lesson: "lesson <list|start|status|hint|check|exit> [課題ID]",
  clear: "clear                               出力を消去",
  exit: "exit                                ターミナルを閉じる",
};

const SHORTCUTS = [
  "Alt/Option + Shift + T    ターミナルを開く・閉じる",
  "Alt/Option + Shift + L    学習パネルを開く・閉じる",
  ...TERMINAL_ROUTES.map((route, i) => `Alt/Option + Shift + ${i + 1}    ${route.label}`),
  "",
  "Enter    コマンド実行",
  "↑ / ↓   コマンド履歴",
  "Tab      候補の補完・表示（候補がなければフォーカス移動）",
  "Esc      ターミナルを閉じる",
];

type TerminalState = Pick<ReturnType<typeof useStore.getState>,
  "scenario" | "activeLessonId" | "completed" | "mutate" | "renewLease" | "plugCable" |
  "startLesson" | "exitLesson" | "completeLesson">;
type Result = { lines: string[]; error?: boolean; href?: string; action?: "clear" | "close" };
const error = (message: string): Result => ({ lines: [message], error: true });
const output = (lines: string[]): Result => ({ lines: lines.length ? lines : ["該当する項目はありません。"] });

export function runTerminalCommand(input: string, state: TerminalState): Result {
  const [command, ...args] = input.trim().split(/\s+/);
  const [first, second, third, fourth, ...rest] = args;
  const s = state.scenario;
  const client = s.clients.find((c) => c.id === first);
  const device = findDevice(s, first);
  const usage = (name: keyof typeof COMMANDS) => error(COMMANDS[name].trim().replace(/ {2,}.*/, ""));

  switch (command) {
    case "help":
      if (args.length) return usage(command);
      return output([
        ...Object.values(COMMANDS), "",
        `画面: ${ROUTES.map((route) => route.id).join(", ")}`,
        "ポート設定例: port sw1 2 native lan / port sw1 8 tagged custom lan iot",
        "native none で未割り当て、tagged all / none でタグ付き VLAN を一括設定。",
        "端末 ID・機器 ID は show で確認できます。Tab で入力候補を表示します。",
      ]);
    case "shortcuts":
      return args.length ? usage(command) : output(SHORTCUTS);
    case "clear":
    case "exit":
      return args.length ? usage(command) : { lines: [], action: command === "clear" ? "clear" : "close" };
    case "go": {
      if (args.length !== 1) return usage(command);
      const route = ROUTES.find(({ id }) => id === first);
      return route ? { lines: [], href: route.href } : error(`画面が見つかりません: ${first}`);
    }
    case "show": {
      if (args.length > 2 || !SHOW.includes(first)) return usage(command);
      if (second && !["clients", "ports"].includes(first)) return usage(command);
      switch (first) {
        case "clients": {
          const clients = second ? s.clients.filter((c) => c.id === second) : s.clients;
          if (second && !clients.length) return error(`端末が見つかりません: ${second}`);
          return output(clients.map((c) => {
            const info = netInfo(s, c.id);
            return `${c.id}  ${c.name}  ${info.ip ?? "IP なし"}  ${info.st.network?.name ?? "—"}  ${info.st.error ?? info.linkLabel}`;
          }));
        }
        case "devices":
          return output(s.devices.map((d) => `${d.id}  ${d.name}  ${d.model}  ${d.ip}`));
        case "networks":
          return output(s.networks.map((n) => `${n.id}  ${n.name}  VLAN ${n.vlanId}  ${n.cidr}  DHCP ${n.dhcp.enabled ? `${n.dhcp.start}–${n.dhcp.end}` : "オフ"}`));
        case "wifi":
          return output(s.ssids.map((w) => `${w.id}  ${w.name}  ${findNetwork(s, w.networkId)?.name ?? "未割り当て"}  ${w.bands.join(" / ")} GHz  ${w.security}`));
        case "issues": {
          const issues = validate(s);
          return output(issues.length ? issues.map((i) => `[${i.severity}] ${i.message}${i.hint ? ` — ${i.hint}` : ""}`) : ["設定上の問題は見つかりませんでした。"]);
        }
        case "ports": {
          const d = second ? findDevice(s, second) : undefined;
          if (second && !d) return error(`機器が見つかりません: ${second}`);
          return output((d ? [d] : s.devices).flatMap((item) => item.ports.map((p) => {
            const peer = portPeer(s, item.id, p.id);
            const connection = peer?.kind === "device" ? `${peer.device.id}/${peer.port.idx}` : peer?.client.id ?? "未接続";
            return `${item.id}/${p.idx}  ${p.name}  ${p.enabled ? "有効" : "無効"}  native=${p.nativeNetworkId ?? "none"}  ${taggedLabel(s, p)}  → ${connection}`;
          })));
        }
      }
      return usage(command);
    }
    case "ping":
    case "trace": {
      if (args.length < 2 || args.length > (command === "ping" ? 2 : 4)) return usage(command);
      if (!client) return error(`送信元の端末が見つかりません: ${first}`);
      const destination = s.clients.find((c) => c.id === second);
      if (command === "ping") {
        const host = destination ? resolveClient(s, destination.id).ip : second;
        if (!host) return error(`${second} に IP アドレスがありません。`);
        const result = probe(s, client.id, host, "icmp", null);
        useSecurityLog.getState().record(client.name, result.security);
        return output(pingLines(s, client.id, host, 4, result));
      }
      if (!destination && second !== "internet") return error(`宛先の端末が見つかりません: ${second}`);
      const protocol = third ?? "icmp";
      if (protocol !== "icmp" && protocol !== "tcp" && protocol !== "udp") return usage(command);
      const port = fourth ? Number(fourth) : null;
      if (protocol === "icmp" ? port !== null : port === null || !/^\d+$/.test(fourth) || port < 1 || port > 65535) {
        return error("TCP / UDP には 1〜65535 のポート番号を指定してください。ICMP にポート指定は不要です。");
      }
      const result = trace(s, { srcId: client.id, dst: second, protocol, port });
      useSecurityLog.getState().record(client.name, result.security);
      return output([
        result.summary,
        ...result.hops.map((hop) => `[${hop.status}] ${hop.title}${hop.detail ? ` — ${hop.detail}` : ""}`),
      ]);
    }
    case "renew":
      if (args.length !== 1) return usage(command);
      if (!client) return error(`端末が見つかりません: ${first}`);
      if (client.ipMode !== "dhcp") return error(`${first} は固定 IP を使用しています。`);
      state.renewLease(client.id);
      return output([`${first} の DHCP リースの更新を要求しました。show clients ${first} で結果を確認できます。`]);
    case "plug":
    case "unplug": {
      if (args.length !== (command === "plug" ? 3 : 1)) return usage(command);
      if (!client) return error(`端末が見つかりません: ${first}`);
      if (client.connection.type !== "wired") return error(`${first} は無線端末です。`);
      if (command === "unplug") {
        state.plugCable(client.id, null, null);
        return output([`${first} のケーブルを抜きました。`]);
      }
      const target = findDevice(s, second);
      const port = target?.ports.find((p) => String(p.idx) === third);
      if (!target || !port) return error(`ポートが見つかりません: ${second}/${third}`);
      if (portBusy(s, target.id, port.id, { clientId: client.id })) return error(`${second}/${third} は使用中です。`);
      state.plugCable(client.id, target.id, port.id);
      return output([`${first} を ${second}/${third} に接続しました。${port.enabled ? "" : " ポートは無効です。"}`]);
    }
    case "port": {
      if (args.length < 3 || !PORT_ACTIONS.includes(third)) return usage(command);
      const port = device?.ports.find((p) => String(p.idx) === second);
      if (!device || !port) return error(`ポートが見つかりません: ${first}/${second}`);
      let changes: Partial<typeof port>;
      if (third === "enable" || third === "disable") {
        if (args.length !== 3) return usage(command);
        changes = { enabled: third === "enable" };
      } else if (third === "native") {
        if (args.length !== 4) return usage(command);
        if (fourth !== "none" && !findNetwork(s, fourth)) return error(`ネットワークが見つかりません: ${fourth}`);
        changes = { nativeNetworkId: fourth === "none" ? null : fourth };
      } else {
        const mode = TAG_MODES.find((value) => value === fourth);
        if (!mode || (mode === "custom" ? !rest.length : rest.length > 0)) {
          return error("tagged all / none または tagged custom <ネットワークID> … を指定してください。");
        }
        const unknown = rest.find((id) => !findNetwork(s, id));
        if (unknown) return error(`ネットワークが見つかりません: ${unknown}`);
        changes = mode === "custom" ? { tagged: mode, taggedNetworkIds: [...new Set(rest)] } : { tagged: mode };
      }
      state.mutate((scenario) => {
        Object.assign(findPort(scenario, device.id, port.id)!, changes);
      });
      return output([`${first}/${second} の設定を更新しました。`]);
    }
    case "lesson": {
      if (!LESSON.includes(first) || args.length !== (first === "start" ? 2 : 1)) return usage(command);
      if (first === "list") {
        return output(LESSONS.map((l) => `${l.id}  ${l.title}${state.completed.includes(l.id) ? "  ✓" : ""}`));
      }
      if (first === "start") {
        const lesson = LESSONS.find((l) => l.id === second);
        if (!lesson) return error(`課題が見つかりません: ${second}`);
        state.startLesson(lesson.id);
        return output([`開始: ${lesson.title}`, ...lesson.goals, "lesson status / hint / check"]);
      }
      const active = LESSONS.find((l) => l.id === state.activeLessonId);
      if (!active) return error("学習中の課題がありません。lesson list で課題を確認できます。");
      if (first === "exit") {
        state.exitLesson();
        return output([`${active.title} を終了しました。`]);
      }
      if (first === "status") return output([active.title, active.story, ...active.goals.map((g) => `· ${g}`)]);
      if (first === "hint") return output(active.hints.map((hint, i) => `${i + 1}. ${hint}`));
      const checks = runChecks(active, s);
      if (checks.every((check) => check.passed)) state.completeLesson(active.id);
      return output([
        ...checks.map(({ check, passed, result }) => `${passed ? "✓" : "×"} ${check.label} — ${result.summary}`),
        `${checks.filter((check) => check.passed).length} / ${checks.length} 合格`,
      ]);
    }
    default:
      return error(`コマンドが見つかりません: ${command}。help で一覧を表示できます。`);
  }
}

export function terminalCompletions(input: string, s: TerminalState["scenario"]) {
  const words = input.trimStart().split(/\s+/);
  const prefix = words.pop() ?? "";
  const [command, first, second, third, fourth] = words;
  const arg = words.length;
  const clients = (wired = false) => s.clients.filter((c) => !wired || c.connection.type === "wired").map((c) => c.id);
  const devices = () => s.devices.map((d) => d.id);
  const ports = (id: string) => findDevice(s, id)?.ports.map((p) => String(p.idx)) ?? [];
  const networks = () => s.networks.map((n) => n.id);
  let candidates: readonly string[] = [];

  if (!arg) candidates = Object.keys(COMMANDS);
  else if (command === "go" && arg === 1) candidates = ROUTES.map((r) => r.id);
  else if (command === "show" && arg === 1) candidates = SHOW;
  else if (command === "show" && arg === 2 && first === "ports") candidates = devices();
  else if (command === "show" && arg === 2 && first === "clients") candidates = clients();
  else if (command === "lesson" && arg === 1) candidates = LESSON;
  else if (command === "lesson" && arg === 2 && first === "start") candidates = LESSONS.map((l) => l.id);
  else if (["ping", "trace", "renew", "plug", "unplug"].includes(command) && arg === 1) candidates = clients(command === "plug" || command === "unplug");
  else if ((command === "ping" || command === "trace") && arg === 2) candidates = [...clients(), "internet"];
  else if (command === "trace" && arg === 3) candidates = ["icmp", "tcp", "udp"];
  else if (command === "plug" && arg === 2) candidates = devices();
  else if (command === "plug" && arg === 3) candidates = ports(second);
  else if (command === "port" && arg === 1) candidates = devices();
  else if (command === "port" && arg === 2) candidates = ports(first);
  else if (command === "port" && arg === 3) candidates = PORT_ACTIONS;
  else if (command === "port" && third === "native" && arg === 4) candidates = [...networks(), "none"];
  else if (command === "port" && third === "tagged" && arg === 4) candidates = TAG_MODES;
  else if (command === "port" && third === "tagged" && fourth === "custom") candidates = networks().filter((id) => !words.slice(5).includes(id));

  return { prefix, matches: candidates.filter((value) => value.startsWith(prefix)) };
}
