export type Booking = {
  id: string;
  starts_at: string;
  price_cents: number | null;
  status: string;
  customer: string;
  service: string;
  professional: string;
  credited: number;
  discounted: number;
  received: number;
};
export type Entry = {
  id: string;
  local_time: string;
  kind: "payment" | "refund" | "discount";
  method: string;
  amount_cents: number;
  service: string;
  professional: string;
  customer: string;
};
export type Expense = {
  id: string;
  description: string;
  category: string;
  amount_cents: number;
  due_date: string;
  installment: number | null;
  paid_on: string | null;
  method: string | null;
};
export type Report = {
  timezone: string;
  bookings: Booking[];
  entries: Entry[];
  expenses: Expense[];
  commissions: number;
};
export const money = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    cents / 100,
  );
export const kinds = {
  payment: "Recebimento",
  refund: "Estorno",
  discount: "Desconto",
};
export function summary(data: Report, from: string, to: string) {
  const sum = (rows: { amount_cents: number }[]) =>
    rows.reduce((a, b) => a + b.amount_cents, 0);
  const inPeriod = (d: string | null) => d !== null && d >= from && d <= to;
  const gross = sum(data.entries.filter((e) => e.kind === "payment")),
    refunds = sum(data.entries.filter((e) => e.kind === "refund")),
    discount = sum(data.entries.filter((e) => e.kind === "discount"));
  const paid = sum(data.expenses.filter((e) => inPeriod(e.paid_on))),
    due = data.expenses.filter((e) => inPeriod(e.due_date));
  const valid = data.bookings.filter(
      (b) => !["cancelled", "no_show"].includes(b.status),
    ),
    completed = valid.filter(
      (b) => b.status === "completed" && b.price_cents !== null,
    );
  const forecast = valid.reduce((a, b) => a + (b.price_cents ?? 0), 0),
    pending = valid.reduce(
      (a, b) => a + Math.max(0, (b.price_cents ?? 0) - b.credited),
      0,
    );
  const accrued = valid
    .filter((b) => b.status === "completed")
    .reduce(
      (a, b) =>
        a +
        (b.price_cents === null ? b.received : b.price_cents - b.discounted),
      0,
    );
  return {
    accrued,
    operatingResult: accrued - sum(due),
    gross,
    refunds,
    discount,
    net: gross - refunds,
    paid,
    cash: gross - refunds - paid,
    operating: sum(due),
    payable: sum(due.filter((e) => !e.paid_on || e.paid_on > to)),
    forecast,
    pending,
    ticket: completed.length
      ? Math.round(
          completed.reduce((a, b) => a + (b.price_cents ?? 0), 0) /
            completed.length,
        )
      : 0,
  };
}
export function csv(rows: (string | number)[][]) {
  // Prefix spreadsheet formula cells before quoting user-entered text.
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((value) => {
            const s = String(value);
            return (
              '"' +
              (/^[\s]*[=+@\-]/.test(s) ? "'" : "") +
              s.replaceAll('"', '""') +
              '"'
            );
          })
          .join(";"),
      )
      .join("\r\n")
  );
}
