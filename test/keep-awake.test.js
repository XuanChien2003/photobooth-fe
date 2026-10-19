import assert from "node:assert/strict";
import { test } from "node:test";
import { inOpenHours, KEEP_AWAKE_MS, OPEN_HOURS } from "../src/network.js";

// 2026-10-16 in Vietnam (UTC+7) at the given hour.
const vietnam = (hour, minute = 0) => new Date(Date.UTC(2026, 9, 16, hour - 7, minute));

test("pings only during shop hours in Vietnam time, whatever the visitor's time zone", () => {
  // Tiệm mở 9h–23h: giữ thức từ 8h để máy chủ chạy sẵn trước khách đầu tiên.
  assert.equal(inOpenHours(vietnam(7, 59)), false);
  assert.equal(inOpenHours(vietnam(8, 0)), true);
  assert.equal(inOpenHours(vietnam(9, 0)), true, "giờ mở cửa");
  assert.equal(inOpenHours(vietnam(14, 30)), true);
  assert.equal(inOpenHours(vietnam(22, 59)), true);
  assert.equal(inOpenHours(vietnam(23, 0)), false);
  assert.equal(inOpenHours(vietnam(2, 0)), false, "a forgotten tab does not keep the server up overnight");
  assert.equal(inOpenHours(vietnam(9, 0), { from: 10, to: 12 }), false);
  assert.ok(OPEN_HOURS.from <= 9 && OPEN_HOURS.to >= 23, "phủ kín giờ mở cửa 9h–23h");
});

test("the ping interval stays safely under Render's 15 minute idle limit and its monthly hours", () => {
  assert.ok(KEEP_AWAKE_MS <= 10 * 60_000, "at least one request before the 15 minute sleep");
  const hoursPerMonth = (OPEN_HOURS.to - OPEN_HOURS.from) * 31;
  assert.ok(hoursPerMonth < 750, `${hoursPerMonth} h/month stays under the 750 h free allowance`);
});
