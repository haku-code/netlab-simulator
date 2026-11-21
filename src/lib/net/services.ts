import type { Client, ClientKind, Protocol } from "../model";

export const LISTEN: Record<ClientKind, number[]> = {
  pc: [],
  phone: [],
  tv: [7000, 8008, 8009],
  iot: [80, 554],
  server: [53, 80, 443, 445, 5000, 8123],
  printer: [80, 443, 631, 9100],
};

export function listensOn(client: Client, protocol: Protocol, port: number) {
  if (client.kind === "server" && client.webService) {
    return protocol === "tcp" && (port === 80 || (port === 443 && client.webService.tls !== "disabled"));
  }
  return LISTEN[client.kind].includes(port);
}
