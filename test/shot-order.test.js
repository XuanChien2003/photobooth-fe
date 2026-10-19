import assert from "node:assert/strict";
import { test } from "node:test";
import { orderBoothShots } from "../src/kiosk/shot-order.js";

test("the newest capture stays first when it saves before the older pending photo", () => {
  const older = { key: "older", src: "blob:older", label: "Saving" };
  const newer = { key: "newer", src: "blob:newer", label: "Saving" };
  const captureOrder = ["older", "newer"];
  assert.equal(orderBoothShots([newer, older], captureOrder)[0], newer);
  const saved = { ...newer, src: "/api/newer", label: "#01" };
  assert.equal(orderBoothShots([older, saved], captureOrder)[0], saved);
  // Server numbering reflects commit order, not capture order; reload uses the
  // chronology persisted beside this kiosk session, without changing print data.
  const persisted = JSON.parse(JSON.stringify({ captureOrder }));
  assert.equal(orderBoothShots([{ ...older, label: "#02" }, saved], persisted.captureOrder)[0], saved);
});

test("legacy server shots keep their order and a new capture goes ahead of them", () => {
  const shots = [{ key: "server-3" }, { key: "server-2" }, { key: "server-1" }];
  assert.equal(orderBoothShots(shots), shots);
  assert.deepEqual(orderBoothShots(shots, ["removed"]), shots);
  assert.deepEqual(orderBoothShots([...shots, { key: "new" }], ["new"])
    .map(shot => shot.key), ["new", "server-3", "server-2", "server-1"]);
});
