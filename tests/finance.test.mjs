import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
const source = stripTypeScriptTypes(
  readFileSync(
    new URL("../components/financial-model.ts", import.meta.url),
    "utf8",
  ),
);
const { summary, csv } = await import(
  "data:text/javascript;base64," + Buffer.from(source).toString("base64")
);
test("caixa, competência e descontos usam datas e bases separadas", () => {
  const data = {
    entries: [
      { kind: "payment", amount_cents: 8000 },
      { kind: "refund", amount_cents: 1000 },
      { kind: "discount", amount_cents: 500 },
    ],
    bookings: [
      {
        status: "completed",
        price_cents: 10000,
        credited: 7500,
        discounted: 500,
        received: 7000,
      },
      { status: "cancelled", price_cents: 2000, credited: 0 },
      { status: "pending", price_cents: null, credited: 0 },
    ],
    expenses: [
      { due_date: "2026-10-30", paid_on: "2026-11-01", amount_cents: 1000 },
      { due_date: "2026-11-20", paid_on: null, amount_cents: 2000 },
      { due_date: "2026-11-30", paid_on: "2026-12-01", amount_cents: 500 },
    ],
  };
  assert.deepEqual(summary(data, "2026-11-01", "2026-11-30"), {
    accrued: 9500,
    operatingResult: 7000,
    gross: 8000,
    refunds: 1000,
    discount: 500,
    net: 7000,
    paid: 1000,
    cash: 6000,
    operating: 2500,
    payable: 2500,
    forecast: 10000,
    pending: 2500,
    ticket: 10000,
  });
});
test("CSV preserva delimitadores e neutraliza fórmulas", () =>
  assert.equal(csv([["=1", "Ana;Luz", '"']]), '\uFEFF"\'=1";"Ana;Luz";""""'));
