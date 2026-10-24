import assert from "node:assert/strict";
import { test } from "node:test";
import { discount } from "./discount.js";

test("regular members pay full price", () => {
  assert.equal(discount(100, "REGULAR"), 100);
});

test("VIP members pay 80%", () => {
  assert.equal(discount(100, "VIP"), 80);
});

test("VIP price matches the 2025 price list", () => {
  // The 2025 price list says VIP pays 90 for a 100 item.
  assert.equal(discount(100, "VIP"), 90);
});
