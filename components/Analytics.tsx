"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { db } from "../lib/db";
import "./analytics.css";

type Row = { name: string; count?: number; cash?: number };
type Report = {
  counts: { day_count: number; week_count: number; month_count: number };
  totalCustomers: number;
  financial: boolean;
  occupancy: number | null;
  cancelRate: number | null;
  ticket: number | null;
  dayCash: number;
  monthCash: number;
  monthly: Row[];
  team: Row[];
  hours: Row[];
  expenses: Row[];
  comparison: Row[];
};
const money = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    cents / 100,
  );
const percent = (v: number | null) =>
  v === null ? "—" : v.toLocaleString("pt-BR") + "%";

function Series({
  title,
  rows,
  field,
}: {
  title: string;
  rows: Row[];
  field: "count" | "cash";
}) {
  return (
    <article className="analytics-box">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p>Sem registros neste período.</p>
      ) : (
        <ResponsiveContainer width="100%" height={190}>
          <BarChart
            data={rows}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 4"
              vertical={false}
              stroke="currentColor"
              opacity={0.12}
            />
            <XAxis
              dataKey="name"
              interval="preserveStartEnd"
              tick={{ fontSize: 11, fill: "currentColor" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              width={56}
              allowDecimals={false}
              tick={{ fontSize: 11, fill: "currentColor" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) =>
                field === "cash"
                  ? "R$ " +
                    (Number(v) / 100).toLocaleString("pt-BR", {
                      notation: "compact",
                    })
                  : String(v)
              }
            />
            <Tooltip
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <div className="analytics-tip">
                    {label} ·{" "}
                    {field === "cash"
                      ? money(Number(payload[0].value))
                      : String(payload[0].value)}
                  </div>
                ) : null
              }
            />
            <Bar
              dataKey={field}
              fill={field === "cash" ? "#4667d8" : "#059a80"}
              maxBarSize={44}
              radius={[5, 5, 0, 0]}
              animationDuration={320}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </article>
  );
}

export default function Analytics({
  tenantId,
  start,
  end,
}: {
  tenantId: string;
  start: string;
  end: string;
}) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true,
      pending = false;
    setReport(null);
    setError(false);
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const { data, error } = await db().rpc("analytics", {
          p_tenant: tenantId,
          p_from: start,
          p_to: end,
        });
        if (active) {
          setError(!!error);
          if (!error) setReport(data as Report);
        }
      } catch {
        if (active) setError(true);
      } finally {
        pending = false;
      }
    }
    void refresh();
    const timer = setInterval(refresh, 20000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [tenantId, start, end]);
  if (!report)
    return (
      <p role="status">
        {error
          ? "Indicadores adicionais indisponíveis."
          : "Carregando indicadores…"}
      </p>
    );
  const metrics = [
    ["Agendamentos hoje", report.counts.day_count],
    ["Agendamentos nesta semana", report.counts.week_count],
    ["Agendamentos neste mês", report.counts.month_count],
    ["Clientes cadastrados", report.totalCustomers],
    ["Ocupação no período", percent(report.occupancy)],
    ["Cancelamentos no período", percent(report.cancelRate)],
    ...(report.financial
      ? [
          ["Receita recebida hoje", money(report.dayCash)],
          ["Receita recebida neste mês", money(report.monthCash)],
          [
            "Ticket médio no período",
            report.ticket === null ? "—" : money(report.ticket),
          ],
        ]
      : []),
  ];
  return (
    <section className="analytics-section" aria-label="Análise operacional">
      <h2>Indicadores operacionais</h2>
      {error && (
        <p role="status">Atualização pendente. Exibindo a última consulta.</p>
      )}
      <dl>
        {metrics.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="analytics-grid">
        <Series
          title="Agendamentos por horário"
          rows={report.hours}
          field="count"
        />
        <Series
          title="Atendimentos concluídos por profissional"
          rows={report.team}
          field="count"
        />
        <Series
          title="Agendamentos comparados ao período anterior"
          rows={report.comparison}
          field="count"
        />
        {report.financial && (
          <>
            <Series
              title="Recebimentos comparados ao período anterior"
              rows={report.comparison}
              field="cash"
            />
            <Series
              title={`Recebimentos mensais em ${end.slice(0, 4)}`}
              rows={report.monthly}
              field="cash"
            />
            <Series
              title="Receita recebida por profissional"
              rows={report.team}
              field="cash"
            />
            <Series
              title="Despesas pagas por categoria"
              rows={report.expenses}
              field="cash"
            />
          </>
        )}
      </div>
    </section>
  );
}
