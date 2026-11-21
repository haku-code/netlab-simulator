import { CONNECT_DBM, rssiAt, type Band } from "../floor";
import type { Device, Scenario } from "../model";
import { wifiSupports6GHz } from "../wifi-security";

const low5GHz = [36, 40, 44, 48];
const mid5GHz = [52, 56, 60, 64];
const high5GHz = [149, 153, 157, 161];
const channels6GHz = Array.from({ length: 24 }, (_, i) => 1 + 4 * i);

export const WIFI_CHANNELS: Record<Band, number[]> = {
  "2.4": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  "5": [...low5GHz, ...mid5GHz, ...high5GHz],
  "6": channels6GHz,
};

export const WIFI_WIDTHS: Record<Band, number[]> = {
  "2.4": [20, 40],
  "5": [20, 40, 80, 160],
  "6": [20, 40, 80, 160],
};

const DEFAULT_WIDTH: Record<Band, number> = { "2.4": 20, "5": 80, "6": 80 };
const DEFAULT_RATE: Record<Band, number> = { "2.4": 144, "5": 866, "6": 1201 };
const AUTO_CHANNELS: Record<Band, number[]> = { "2.4": [1, 6, 11], "5": [36, 52, 149], "6": [1, 17, 33, 49, 65, 81] };

export function radioHash(value: string) {
  let hash = 0;
  for (const ch of value) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash;
}

export function radioChannels(band: Band, width: number) {
  if (band === "5" && width === 160) return [...low5GHz, ...mid5GHz];
  if (band === "2.4" && width === 40) return WIFI_CHANNELS[band].filter((channel) => channel <= 7);
  return WIFI_CHANNELS[band];
}

export function apRadio(ap: Pick<Device, "id" | "wifiRadios">, band: Band) {
  const config = ap.wifiRadios?.[band];
  const width = config && WIFI_WIDTHS[band].includes(config.width) ? config.width : DEFAULT_WIDTH[band];
  const allowed = radioChannels(band, width);
  const choices = AUTO_CHANNELS[band].filter((channel) => allowed.includes(channel));
  const channel = config && allowed.includes(config.channel) ? config.channel : choices[radioHash(ap.id) % choices.length];
  return { channel, width };
}

function centerFrequency(band: Band, channel: number, width: number) {
  if (band === "2.4") return 2407 + 5 * channel + (width === 40 ? 10 : 0);
  const start = band === "6" ? 1 : channel < 100 ? 36 : 149;
  const blockSize = width / 20;
  const first = start + 4 * blockSize * Math.floor((channel - start) / (4 * blockSize));
  return (band === "5" ? 5000 : 5950) + 5 * (first + 2 * (blockSize - 1));
}

export function apInterference(s: Scenario, ap: Device, band: Band, receiver = ap.pos, excludeId?: string) {
  if (!s.floor || !receiver) return { neighbors: 0, airtime: 1 };
  const { channel, width } = apRadio(ap, band);
  const center = centerFrequency(band, channel, width);
  let neighbors = 0;
  let contention = 0;
  for (const other of s.devices) {
    if (other.type !== "ap" || other.id === ap.id || other.id === excludeId || !other.pos) continue;
    if (!s.ssids.some((w) => w.bands.includes(band) && (band !== "6" || wifiSupports6GHz(w.security)) && (!w.apIds || w.apIds.includes(other.id)))) continue;
    const rssi = rssiAt(s.floor, other, receiver, band);
    if (rssi < CONNECT_DBM) continue;
    const radio = apRadio(other, band);
    const otherCenter = centerFrequency(band, radio.channel, radio.width);
    const overlap = Math.min(center + width / 2, otherCenter + radio.width / 2)
      - Math.max(center - width / 2, otherCenter - radio.width / 2);
    if (overlap <= 0) continue;
    neighbors++;
    contention += overlap / width * (rssi >= -65 ? 1 : 0.5);
  }
  return { neighbors, airtime: 1 / (1 + contention) };
}

export function radioRate(band: Band, width: number, rssi: number, airtime = 1) {
  const signal = rssi > -55 ? 1 : rssi > -65 ? 0.7 : rssi > -72 ? 0.4 : 0.15;
  return Math.round(DEFAULT_RATE[band] * (width / DEFAULT_WIDTH[band]) * signal * airtime);
}

const MESH_EDGE_PREFIX = "mesh:";
export const meshEdgeId = (childId: string) => MESH_EDGE_PREFIX + childId;
export const isMeshEdge = (id: string) => id.startsWith(MESH_EDGE_PREFIX);
export const meshParent = (s: Scenario, ap: Device) =>
  s.devices.find((d) => ap.type === "ap" && d.type === "ap" && d.id === ap.meshParentId && d.id !== ap.id);

function meshSignal(s: Scenario, receiver: Device, transmitter: Device) {
  return s.floor && receiver.pos && transmitter.pos ? rssiAt(s.floor, transmitter, receiver.pos, "5") : -58;
}

/** 全区間で電波が届き、親をたどると有線モードの AP に到着すること。 */
export function meshHop(s: Scenario, child: Device) {
  const parent = meshParent(s, child);
  if (!parent) return null;
  const seen = new Set([child.id]);
  const rssi = Math.min(meshSignal(s, child, parent), meshSignal(s, parent, child));
  for (let from = child, to: Device | undefined = parent; to; to = meshParent(s, from)) {
    if (seen.has(to.id) || Math.min(meshSignal(s, from, to), meshSignal(s, to, from)) < CONNECT_DBM) return null;
    seen.add(to.id);
    from = to;
    if (from.meshParentId && !meshParent(s, from)) return null;
  }
  return { id: meshEdgeId(child.id), child, parent, rssi };
}

export function meshLink(s: Scenario, child: Device) {
  const hop = meshHop(s, child);
  if (!hop) return null;
  const { channel, width } = apRadio(hop.parent, "5");
  const { airtime } = apInterference(s, hop.parent, "5", child.pos, child.id);
  return { ...hop, channel, width, rate: radioRate("5", width, hop.rssi, airtime) };
}

export function meshPathRate(s: Scenario, childId: string) {
  const child = s.devices.find((d) => d.id === childId);
  return child ? meshLink(s, child)?.rate : undefined;
}
