"use client";
import { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { Report, money } from "./financial-model";

const choices = {
  day: "Receita diária",
  month: "Receita mensal",
  professional: "Receita por profissional",
  service: "Receita por serviço",
  category: "Despesas por categoria",
};
type Dimension = keyof typeof choices;
export default function FinanceCharts({
  data,
  from,
  to,
}: {
  data: Report;
  from: string;
  to: string;
}) {
  const [dimension, setDimension] = useState<Dimension>("day");
  const groups = new Map<string, number>();
  function add(name: string, amount: number) {
    groups.set(name, (groups.get(name) ?? 0) + amount);
  }
  if (dimension === "category") {
    for (const e of data.expenses)
      if (e.due_date >= from && e.due_date <= to)
        add(e.category, e.amount_cents);
  } else {
    for (const e of data.entries) {
      if (e.kind === "discount") continue;
      const key =
        dimension === "day"
          ? e.local_time.slice(0, 10)
          : dimension === "month"
            ? e.local_time.slice(0, 7)
            : e[dimension];
      add(key, e.kind === "refund" ? -e.amount_cents : e.amount_cents);
    }
  }
  const chronological = dimension === "day" || dimension === "month";
  const rows = Array.from(groups, ([key, amount]) => ({ key, amount })).sort(
    (a, b) =>
      chronological ? a.key.localeCompare(b.key) : b.amount - a.amount,
  );
  const format = (name: string) =>
    dimension === "day"
      ? name.slice(8) + "/" + name.slice(5, 7)
      : dimension === "month"
        ? name.slice(5) + "/" + name.slice(0, 4)
        : name;
  return (
    <section className="fin-box">
      <div className="fin-chart-header">
        <h2>Análise financeira</h2>
        <select
          aria-label="Agrupar gráfico por"
          value={dimension}
          onChange={(e) => setDimension(e.target.value as Dimension)}
        >
          {Object.entries(choices).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {rows.length ? (
        <>
          <div style={{ height: 230, minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={rows}
                margin={{ top: 15, right: 12, left: 0, bottom: 2 }}
                accessibilityLayer
              >
                <CartesianGrid strokeDasharray="3 5" vertical={false} />
                <XAxis
                  dataKey="key"
                  tickFormatter={format}
                  fontSize={11}
                  minTickGap={20}
                />
                <YAxis fontSize={11} tickFormatter={(n) => String(n / 100)} />
                <Tooltip
                  formatter={(value) => money(Number(value))}
                  labelFormatter={(name) => format(String(name))}
                />
                <Bar
                  name={choices[dimension]}
                  dataKey="amount"
                  fill="#7460d3"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={36}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <details>
            <summary>Ver valores do gráfico</summary>
            <dl>
              {rows.map((r) => (
                <div key={r.key}>
                  <dt>{format(r.key)}</dt>
                  <dd>{money(r.amount)}</dd>
                </div>
              ))}
            </dl>
          </details>
        </>
      ) : (
        <p className="fin-empty">Nenhum lançamento neste período.</p>
      )}
    </section>
  );
}
