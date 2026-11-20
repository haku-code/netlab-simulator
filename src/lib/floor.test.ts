import { describe, expect, it } from "vitest";
import { autoFloor, roomAt, rssiAt, wallsBetween, type FloorTemplate } from "./floor";
import { FLOOR_PRESETS } from "./floor-templates";
import { LESSONS } from "./lessons";
import { assignLeases, resolveClient } from "./net/simulate";
import { defaultScenario } from "./scenarios/default";

const office = () => assignLeases(autoFloor(LESSONS.find((l) => l.id === "ap-groups")!.scenario()));

describe("radio model", () => {
  it("counts walls between rooms", () => {
    const f = FLOOR_PRESETS.office.layout;
    expect(wallsBetween(f, { x: 8, y: 6 }, { x: 10, y: 6 })).toBe(0);
    expect(wallsBetween(f, { x: 8, y: 6 }, { x: 29, y: 6 })).toBe(2);
  });
  it("concrete walls attenuate more than wood", () => {
    const ap = { id: "a", type: "ap" as const, name: "", model: "", mac: "", ip: "", ports: [], pos: { x: 0, y: 0 } };
    const p = { x: 6, y: 0 };
    const rooms = [{ id: "a", name: "", x: -1, y: -1, w: 4, h: 2 }, { id: "b", name: "", x: 3, y: -1, w: 4, h: 2 }];
    const wood = rssiAt({ ...FLOOR_PRESETS.house.layout, rooms }, ap, p, "5");
    const concrete = rssiAt({ ...FLOOR_PRESETS.office.layout, rooms }, ap, p, "5");
    expect(wood).toBeGreaterThan(concrete);
  });
});

describe("floor plan presets", () => {
  it.each(Object.keys(FLOOR_PRESETS) as FloorTemplate[])("%s places devices in rooms and keeps Wi-Fi connected", (template) => {
    const s = assignLeases(autoFloor(autoFloor(defaultScenario(), "house"), template));
    const floor = s.floor!;
    const { apRooms, wiredRooms } = FLOOR_PRESETS[template];
    const ids = new Set(floor.rooms.map((r) => r.id));
    expect(floor.template).toBe(template);
    expect(ids.size).toBe(floor.rooms.length);
    for (const id of [floor.closet, ...apRooms, ...Object.values(wiredRooms)]) expect(ids.has(id)).toBe(true);
    expect(floor.rooms.reduce((area, room) => area + room.w * room.h, 0)).toBe(floor.width * floor.height);
    for (const [i, room] of floor.rooms.entries()) {
      expect(room.x).toBeGreaterThanOrEqual(0);
      expect(room.y).toBeGreaterThanOrEqual(0);
      expect(room.x + room.w).toBeLessThanOrEqual(floor.width);
      expect(room.y + room.h).toBeLessThanOrEqual(floor.height);
      const overlaps = floor.rooms.slice(i + 1).some((other) =>
        room.x < other.x + other.w && room.x + room.w > other.x
        && room.y < other.y + other.h && room.y + room.h > other.y,
      );
      expect(overlaps).toBe(false);
    }
    for (const item of [...s.devices, ...s.clients]) expect(roomAt(floor, item.pos!)).toBeDefined();
    for (const client of s.clients) expect(resolveClient(s, client.id).error).toBeUndefined();
  });

  it("preserves existing positions when placing a new device on a saved floor", () => {
    const s = autoFloor(defaultScenario(), "hotel");
    const [existing, missing] = s.devices;
    existing.pos = { x: 4, y: 4 };
    delete missing.pos;
    const savedFloor = s.floor;
    autoFloor(s);
    expect(s.floor).toBe(savedFloor);
    expect(existing.pos).toEqual({ x: 4, y: 4 });
    expect(roomAt(s.floor!, missing.pos!)).toBeDefined();
  });
});

describe("association by position", () => {
  it("connects to the nearest AP and roams when moved", () => {
    const s = office();
    expect(resolveClient(s, "staff-laptop").attachDeviceId).toBe("ap1");
    s.clients.find((c) => c.id === "staff-laptop")!.pos = { x: 30, y: 6 }; // 会議室へ移動
    // 社員用 SSID は Office AP だけから配信 → 会議室では圏外
    expect(resolveClient(s, "staff-laptop").error).toMatch(/電波が弱すぎ/);
    s.ssids.find((w) => w.id === "staff")!.apIds = undefined;
    expect(resolveClient(s, "staff-laptop").attachDeviceId).toBe("ap2");
  });
  it("lower transmit power shrinks coverage", () => {
    const s = office();
    s.ssids.find((w) => w.id === "guest")!.apIds = ["ap2"]; // ゲストは会議室の AP からだけ
    const visitor = s.clients.find((c) => c.id === "visitor-meeting")!;
    visitor.pos = { x: 17, y: 2 }; // ロビー（会議室と壁 1 枚）
    expect(resolveClient(s, "visitor-meeting").error).toBeUndefined();
    s.devices.find((d) => d.id === "ap2")!.txPower = "low";
    expect(resolveClient(s, "visitor-meeting").error).toMatch(/電波が弱すぎ/);
  });
});
