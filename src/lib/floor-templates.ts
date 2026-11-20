import type { ClientKind } from "./model";
import type { FloorLayout, Room } from "./floor";

type RoomSpec = [id: string, name: string, x: number, y: number, width: number, height: number];
type Preset = {
  layout: FloorLayout;
  material: string;
  apRooms: [string, ...string[]];
  wiredRooms: Partial<Record<ClientKind, string>>;
};

const WALLS = {
  wood: { name: "木造", loss: { "2.4": 5, "5": 7, "6": 9 } },
  drywall: { name: "石膏ボード", loss: { "2.4": 3, "5": 5, "6": 7 } },
  concrete: { name: "鉄筋コンクリート", loss: { "2.4": 10, "5": 14, "6": 17 } },
  metal: { name: "金属間仕切り", loss: { "2.4": 12, "5": 18, "6": 22 } },
};

function preset(
  name: string,
  [width, height]: [number, number],
  wall: keyof typeof WALLS,
  closet: string,
  apRooms: Preset["apRooms"],
  wiredRooms: Preset["wiredRooms"],
  rooms: RoomSpec[],
): Preset {
  return {
    layout: {
      name, width, height, closet, wallLoss: WALLS[wall].loss,
      rooms: rooms.map(([id, name, x, y, w, h]): Room => ({ id, name, x, y, w, h })),
    },
    material: WALLS[wall].name,
    apRooms,
    wiredRooms,
  };
}

export const FLOOR_PRESETS = {
  house: preset("一戸建て（木造）", [14, 10], "wood", "storage",
    ["living", "study", "bedroom", "kitchen"], { pc: "study", server: "storage", printer: "study", iot: "living", tv: "living" }, [
      ["living", "リビング", 0, 0, 8, 6],
      ["kitchen", "キッチン", 8, 0, 6, 4],
      ["study", "書斎", 8, 4, 6, 6],
      ["bedroom", "寝室", 0, 6, 5, 4],
      ["storage", "収納", 5, 6, 3, 4],
    ]),
  studio: preset("単身向け（1K）", [8, 6], "drywall", "entry",
    ["living", "kitchen"], { pc: "living", tv: "living" }, [
      ["living", "居室", 0, 0, 5, 6],
      ["kitchen", "キッチン", 5, 0, 3, 2.5],
      ["bath", "浴室", 5, 2.5, 3, 2],
      ["entry", "玄関", 5, 4.5, 3, 1.5],
    ]),
  "apartment-2ldk": preset("マンション（2LDK）", [12, 9], "concrete", "entry",
    ["living", "hall", "bedroom", "study"], { pc: "study", tv: "living", printer: "study" }, [
      ["living", "LDK", 0, 0, 7, 6],
      ["bedroom", "寝室", 7, 0, 5, 4],
      ["study", "洋室", 7, 4, 5, 5],
      ["bath", "水回り", 0, 6, 3, 3],
      ["entry", "玄関", 3, 6, 2, 3],
      ["hall", "廊下", 5, 6, 2, 3],
    ]),
  "apartment-3ldk": preset("マンション（3LDK）", [16, 11], "concrete", "entry",
    ["living", "hall", "study", "bedroom"], { pc: "study", tv: "living", printer: "study" }, [
      ["living", "LDK", 0, 0, 8, 7],
      ["bedroom", "主寝室", 8, 0, 4, 7],
      ["child", "子ども部屋", 12, 0, 4, 7],
      ["hall", "廊下", 0, 7, 16, 1.5],
      ["bath", "水回り", 0, 8.5, 4, 2.5],
      ["entry", "玄関", 4, 8.5, 4, 2.5],
      ["study", "書斎", 8, 8.5, 8, 2.5],
    ]),
  "long-house": preset("細長い平屋", [25, 8], "wood", "storage",
    ["living", "hall", "bedroom", "study"], { pc: "study", tv: "living", printer: "study", server: "storage" }, [
      ["living", "リビング", 0, 0, 8, 6],
      ["kitchen", "台所", 8, 0, 5, 6],
      ["study", "書斎", 13, 0, 5, 6],
      ["bedroom", "寝室", 18, 0, 7, 6],
      ["storage", "収納", 0, 6, 4, 2],
      ["hall", "廊下", 4, 6, 21, 2],
    ]),
  office: preset("オフィス（鉄筋コンクリート）", [34, 12], "concrete", "server",
    ["work", "meeting", "lobby"], { pc: "work", server: "server", printer: "work", iot: "lobby", tv: "meeting" }, [
      ["work", "執務エリア", 0, 0, 16, 12],
      ["lobby", "ロビー", 16, 0, 8, 7],
      ["server", "サーバー室", 16, 7, 8, 5],
      ["meeting", "会議室", 24, 0, 10, 12],
    ]),
  "small-office": preset("小規模オフィス", [18, 10], "drywall", "server",
    ["work", "meeting", "lobby"], { pc: "work", printer: "work", server: "server", tv: "meeting" }, [
      ["work", "執務室", 0, 0, 10, 10],
      ["meeting", "会議室", 10, 0, 8, 5],
      ["lobby", "受付", 10, 5, 5, 5],
      ["server", "機器室", 15, 5, 3, 5],
    ]),
  coworking: preset("コワーキングスペース", [30, 18], "drywall", "server",
    ["work", "lounge", "meeting", "booth"], { pc: "work", printer: "copy", server: "server", tv: "meeting" }, [
      ["work", "共用デスク", 0, 0, 15, 12],
      ["lounge", "ラウンジ", 15, 0, 10, 12],
      ["booth", "個室ブース", 25, 0, 5, 12],
      ["lobby", "受付", 0, 12, 8, 6],
      ["copy", "複合機室", 8, 12, 4, 6],
      ["server", "機器室", 12, 12, 4, 6],
      ["meeting", "会議室", 16, 12, 14, 6],
    ]),
  cafe: preset("カフェ", [17, 12], "wood", "office",
    ["seats", "counter", "kitchen"], { pc: "office", printer: "counter", iot: "kitchen", tv: "seats" }, [
      ["seats", "客席", 0, 0, 11, 12],
      ["counter", "カウンター", 11, 0, 6, 3],
      ["kitchen", "厨房", 11, 3, 6, 6],
      ["office", "事務室", 11, 9, 6, 3],
    ]),
  retail: preset("小売店", [28, 17], "drywall", "office",
    ["sales", "register", "stock"], { pc: "office", printer: "register", server: "office", tv: "sales" }, [
      ["sales", "売場", 0, 0, 21, 12],
      ["register", "レジ", 0, 12, 12, 5],
      ["entry", "入口", 12, 12, 9, 5],
      ["stock", "在庫室", 21, 0, 7, 10],
      ["office", "事務室", 21, 10, 7, 7],
    ]),
  clinic: preset("クリニック", [24, 16], "drywall", "office",
    ["waiting", "hall", "exam1", "exam2"], { pc: "exam1", printer: "waiting", server: "office", tv: "waiting" }, [
      ["waiting", "受付・待合", 0, 0, 10, 9],
      ["hall", "廊下", 10, 0, 3, 16],
      ["exam1", "診察室 1", 13, 0, 11, 5],
      ["exam2", "診察室 2", 13, 5, 11, 5],
      ["lab", "検査室", 13, 10, 11, 6],
      ["office", "事務室", 0, 9, 10, 7],
    ]),
  school: preset("学校（教室棟）", [42, 16], "concrete", "staff",
    ["class2", "hall", "class1", "class3", "staff"], { pc: "class2", printer: "staff", server: "staff", tv: "class1" }, [
      ["class1", "教室 1", 0, 0, 10, 9],
      ["class2", "教室 2", 10, 0, 10, 9],
      ["class3", "教室 3", 20, 0, 10, 9],
      ["class4", "教室 4", 30, 0, 12, 9],
      ["hall", "廊下", 0, 9, 42, 2.5],
      ["staff", "職員室", 0, 11.5, 15, 4.5],
      ["library", "図書室", 15, 11.5, 17, 4.5],
      ["storage", "倉庫", 32, 11.5, 10, 4.5],
    ]),
  hotel: preset("ホテル（客室フロア）", [36, 18], "concrete", "service",
    ["hall", "lobby", "room3", "room6"], { pc: "service", printer: "service", tv: "room3" }, [
      ["room1", "客室 101", 0, 0, 9, 7.5],
      ["room2", "客室 102", 9, 0, 9, 7.5],
      ["room3", "客室 103", 18, 0, 9, 7.5],
      ["service", "サービス室", 27, 0, 9, 7.5],
      ["hall", "廊下", 0, 7.5, 36, 3],
      ["room4", "客室 104", 0, 10.5, 9, 7.5],
      ["room5", "客室 105", 9, 10.5, 9, 7.5],
      ["room6", "客室 106", 18, 10.5, 9, 7.5],
      ["lobby", "エレベーターホール", 27, 10.5, 9, 7.5],
    ]),
  warehouse: preset("物流倉庫", [48, 26], "metal", "office",
    ["warehouse", "packing", "dock"], { pc: "office", server: "office", printer: "packing", iot: "dock", tv: "office" }, [
      ["warehouse", "保管エリア", 0, 0, 32, 19],
      ["cold", "冷蔵庫", 32, 0, 16, 9],
      ["packing", "梱包エリア", 32, 9, 16, 10],
      ["dock", "荷さばき場", 0, 19, 35, 7],
      ["office", "事務室", 35, 19, 13, 7],
    ]),
} as const;
