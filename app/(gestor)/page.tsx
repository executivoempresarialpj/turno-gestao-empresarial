"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  CalendarDays,
  ChartColumn,
  Clock3,
  Wallet,
  Users,
  Plus,
  Layers3,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import Analytics from "@/components/Analytics";
import { useTenant } from "@/lib/tenant";
import { db } from "@/lib/db";
const money = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    v / 100,
  );
const shift = (day: string, n: number) =>
  new Date(Date.parse(day + "T12:00:00Z") + 86400000 * n)
    .toISOString()
    .slice(0, 10);
type Report = {
  financial: boolean;
  bookings: number;
  customers: number;
  received: number;
  forecast: number;
  spent: number;
  series: { d: string; received: number; spent: number }[];
  ranking: { name: string; n: number }[];
  status: Record<string, number>;
};
export default function Overview() {
  const tenant = useTenant(),
    today = new Intl.DateTimeFormat("en-CA", {
      timeZone: tenant.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  const [period, setPeriod] = useState("7"),
    [from, setFrom] = useState(today),
    [to, setTo] = useState(today),
    [report, setReport] = useState<Report | null>(null),
    [error, setError] = useState("");
  const end =
      period === "custom"
        ? to
        : period === "yesterday"
          ? shift(today, -1)
          : today,
    start =
      period === "custom"
        ? from
        : period === "month"
          ? today.slice(0, 7) + "-01"
          : period === "year"
            ? today.slice(0, 4) + "-01-01"
            : period === "yesterday"
              ? end
              : shift(today, 1 - Number(period));
  useEffect(() => {
    let alive = true,
      seq = 0;
    const c = db();
    async function refresh() {
      const count = ++seq;
      const r = await c.rpc("dashboard", {
        p_tenant: tenant.tenantId,
        p_from: start,
        p_to: end,
      });
      if (alive && count === seq) {
        setError(
          r.error
            ? "Falha ao carregar indicadores. Verifique o período selecionado."
            : "",
        );
        setReport(r.error ? null : r.data);
      }
    }
    setReport(null);
    refresh();
    const timer = setInterval(refresh, 15000);
    const channel = c
      .channel("dashboard-" + tenant.tenantId)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: "tenant_id=eq." + tenant.tenantId,
        },
        () => {
          refresh();
        },
      )
      .subscribe();
    return () => {
      alive = false;
      clearInterval(timer);
      void c.removeChannel(channel);
    };
  }, [start, end, tenant.tenantId]);
  return (
    <>
      <div className="overview-heading">
        <div>
          <div className="eyebrow">
            <span /> PAINEL EXECUTIVO
          </div>
          <h1>Visão geral</h1>
          <p>Acompanhe o desempenho de {tenant.tenantName}.</p>
        </div>
        <Link className="primary" href="/agenda">
          <CalendarDays size={16} /> Abrir agenda
        </Link>
      </div>
      <div className="period">
        <h2>Resumo do período</h2>
        <select
          aria-label="Período"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
        >
          {[
            ["1", "Hoje"],
            ["yesterday", "Ontem"],
            ["7", "Últimos 7 dias"],
            ["30", "Últimos 30 dias"],
            ["month", "Mês atual"],
            ["year", "Ano atual"],
            ["custom", "Personalizado"],
          ].map(([v, n]) => (
            <option key={v} value={v}>
              {n}
            </option>
          ))}
        </select>
      </div>
      {period === "custom" && (
        <div className="period">
          <label>
            De{" "}
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            Até{" "}
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="kpis">
        {[
          [
            CalendarDays,
            "Agendamentos",
            report?.bookings,
            "Reservas no período",
          ],
          [
            Wallet,
            "Receita recebida",
            report?.financial ? money(report.received) : null,
            report && !report.financial
              ? "Sem acesso ao financeiro"
              : "Entradas menos estornos",
          ],
          [
            Clock3,
            "Receita prevista",
            report && money(report.forecast),
            "Atendimentos em aberto",
          ],
          [
            Users,
            "Clientes atendidos",
            report?.customers,
            "Com atendimento concluído",
          ],
        ].map(([IconRaw, label, value, detail], i) => {
          const Icon = IconRaw as typeof Wallet;
          return (
            <article key={i}>
              <div className={"tileicon tone" + i}>
                <Icon size={20} />
              </div>
              <p>{String(label)}</p>
              <strong>{(value as React.ReactNode) ?? "—"}</strong>
              <small>{String(detail)}</small>
            </article>
          );
        })}
      </div>
      <div className="panels">
        <section>
          <div className="panel-head">
            <div>
              <small>FINANCEIRO</small>
              <h2>Fluxo de caixa</h2>
            </div>
            <Activity size={20} />
          </div>
          {report && !report.financial ? (
            <p>O fluxo de caixa exige acesso ao módulo financeiro.</p>
          ) : (
            <>
              <div className="legend">
                ● Recebimentos <span>● Despesas</span>
              </div>
              <div style={{ height: 245 }}>
                <ResponsiveContainer>
                  <AreaChart data={report?.series || []}>
                    <defs>
                      <linearGradient id="a" x1="0" y1="0" x2="0" y2="1">
                        <stop
                          offset="0"
                          stopColor="#7762ed"
                          stopOpacity={0.35}
                        />
                        <stop offset="1" stopColor="#7762ed" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      stroke="#dddce7"
                      strokeDasharray="3 5"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="d"
                      tickFormatter={(v) => v.slice(8) + "/" + v.slice(5, 7)}
                      fontSize={11}
                    />
                    <YAxis
                      tickFormatter={(v) => "R$ " + v / 100}
                      fontSize={10}
                    />
                    <Tooltip formatter={(v) => money(Number(v))} />
                    <Area
                      name="Recebimentos"
                      type="monotone"
                      dataKey="received"
                      stroke="#7360e6"
                      fill="url(#a)"
                      strokeWidth={3}
                    />
                    <Area
                      name="Despesas"
                      dataKey="spent"
                      stroke="#36a59c"
                      fill="transparent"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </section>
        <section>
          <div className="panel-head">
            <div>
              <small>DESEMPENHO</small>
              <h2>Serviços mais agendados</h2>
            </div>
            <Layers3 size={18} />
          </div>
          {report?.ranking.map((s, i) => (
            <div className="ranking" key={s.name}>
              <span>{s.name}</span>
              <b>{s.n}</b>
              <progress value={s.n} max={report.ranking[0].n} />
            </div>
          ))}
          {report && !report.ranking.length && (
            <p>O ranking aparece com a primeira reserva do período.</p>
          )}
        </section>
      </div>
      <section className="statuspanel">
        <h2>Agendamentos por status</h2>
        <div>
          {Object.entries({
            pending: "Pendentes",
            confirmed: "Confirmados",
            in_progress: "Em atendimento",
            completed: "Concluídos",
            cancelled: "Cancelados",
            no_show: "Faltas",
          }).map(([k, v]) => (
            <span key={k}>
              {v} <b>{report ? report.status[k] || 0 : "—"}</b>
            </span>
          ))}
        </div>
      </section>
      <Analytics tenantId={tenant.tenantId} start={start} end={end} />
    </>
  );
}
