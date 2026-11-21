import { expect, it } from "vitest";
import { FIRST_CONNECTION, firstConnection } from "./first-connection";

it("distinguishes a disconnected cable, a missing address and a failed name lookup", () => {
  expect(firstConnection(FIRST_CONNECTION)).toMatchObject({ ip: "192.168.1.6", web: { status: "ok" } });
  expect(firstConnection({ ...FIRST_CONNECTION, cable: false })).toMatchObject({ ip: undefined, web: { status: "noip" } });
  expect(firstConnection({ ...FIRST_CONNECTION, dhcp: false })).toMatchObject({ ip: undefined, web: { status: "noip" } });
  expect(firstConnection({ ...FIRST_CONNECTION, dns: false })).toMatchObject({
    ip: "192.168.1.6",
    web: { status: "dns" },
    direct: { status: "ok" },
  });
  expect(firstConnection(FIRST_CONNECTION).web.status).toBe("ok");
});
