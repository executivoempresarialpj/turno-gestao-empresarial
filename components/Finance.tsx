"use client";
import { useEffect, useRef, useState, FormEvent } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Wallet,
  CircleDollarSign,
  Download,
  Plus,
  Printer,
} from "lucide-react";
import ManualReceipt from "./ManualReceipt";
import { db } from "@/lib/db";
import { useTenant } from "@/lib/tenant";
import { Report, summary, money, kinds, csv, Expense } from "./financial-model";
import FinanceCharts from "./FinanceCharts";
import "./finance.css";

const methods = [
  "PIX",
  "Dinheiro",
  "Cartão de crédito",
  "Cartão de débito",
  "Transferência",
  "Outros",
];
const categories = [
  "Aluguel",
  "Energia",
  "Água",
  "Internet",
  "Materiais",
  "Produtos",
  "Salários",
  "Comissões",
  "Marketing",
  "Impostos",
  "Outras despesas",
];
function tenantToday(tz: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (key: string) =>
    Number(parts.find((p) => p.type === key)?.value);
  return new Date(part("year"), part("month") - 1, part("day"));
}
function localDate(d: Date) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}
const day = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
type Mode = "income" | "expense" | "settle" | null;
export default function Finance({ reports = false }: { reports?: boolean }) {
  const { tenantId, tenantName, timezone } = useTenant(),
    now = tenantToday(timezone);
  const [from, setFrom] = useState(
      localDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    ),
    [to, setTo] = useState(
      localDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    );
  const [data, setData] = useState<Report | null>(null),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0),
    [mode, setMode] = useState<Mode>(null),
    [expense, setExpense] = useState<Expense | null>(null);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [formError, setFormError] = useState(""),
    [tab, setTab] = useState("receipts"),
    [paid, setPaid] = useState(false);
  const [frequency, setFrequency] = useState("once");
  const request = useRef(""),
    dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!tenantId) return;
    let live = true;
    setData(null);
    setError("");
    db()
      .rpc("financial_report", { p_tenant: tenantId, p_start: from, p_end: to })
      .then(({ data, error }) => {
        if (live) {
          if (error) setError(error.message);
          else setData(data as Report);
        }
      });
    return () => {
      live = false;
    };
  }, [tenantId, from, to, refresh]);
  useEffect(() => {
    if (mode) dialog.current?.showModal();
    else dialog.current?.close();
  }, [mode]);
  function open(next: Mode, row: Expense | null = null) {
    setExpense(row);
    setFormError("");
    setNotice("");
    setPaid(false);
    setFrequency("once");
    request.current = crypto.randomUUID();
    setMode(next);
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setFormError("");
    const fields = new FormData(e.currentTarget),
      get = (k: string) => String(fields.get(k) ?? ""),
      amount = Math.round(Number(get("amount")) * 100);
    try {
      const result =
        mode === "income"
          ? await db().rpc("record_payment", {
              p_tenant: tenantId,
              p_booking: get("booking"),
              p_amount: amount,
              p_kind: get("kind"),
              p_method: get("method"),
              p_request: request.current,
            })
          : mode === "expense"
            ? await db().rpc(
                frequency === "once"
                  ? "record_expense"
                  : "record_expense_series",
                {
                  ...(frequency === "once"
                    ? {}
                    : {
                        p_frequency: frequency,
                        p_occurrences: Number(get("occurrences")),
                      }),
                  p_tenant: tenantId,
                  p_description: get("description"),
                  p_category: get("category"),
                  p_amount: amount,
                  p_due: get("due"),
                  p_paid: paid ? get("paidOn") : null,
                  p_method: paid ? get("method") : null,
                  p_request: request.current,
                },
              )
            : await db().rpc("settle_expense", {
                p_tenant: tenantId,
                p_id: expense?.id,
                p_date: get("paidOn"),
                p_method: get("method"),
              });
      if (result.error) throw new Error(result.error.message);
      setNotice("Lançamento registrado.");
      setMode(null);
      setRefresh((x) => x + 1);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Falha ao registrar lançamento.",
      );
    } finally {
      setBusy(false);
    }
  }
  function download() {
    if (!data) return;
    const rows: (string | number)[][] = [
      [
        "Tipo",
        "Data",
        "Descrição",
        "Profissional",
        "Cliente",
        "Categoria",
        "Forma",
        "Valor (R$)",
        "Pagamento",
      ],
    ];
    data.entries.forEach((e) =>
      rows.push([
        kinds[e.kind],
        day(e.local_time),
        e.service,
        e.professional,
        e.customer,
        "",
        e.method,
        (e.amount_cents / 100).toFixed(2).replace(".", ","),
        "",
      ]),
    );
    data.expenses.forEach((e) =>
      rows.push([
        "Despesa",
        day(e.due_date),
        e.description,
        "",
        "",
        e.category,
        e.method ?? "",
        (e.amount_cents / 100).toFixed(2).replace(".", ","),
        e.paid_on ? day(e.paid_on) : "Pendente",
      ]),
    );
    const url = URL.createObjectURL(
      new Blob([csv(rows)], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "financeiro-" + from + "-" + to + ".csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const totals = data && summary(data, from, to);
  const dates = (
    <div className="fin-dates">
      <label>
        De
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
      </label>
      <label>
        Até
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </label>
    </div>
  );
  const method = (
    <label>
      Forma de pagamento
      <select name="method">
        {methods.map((m) => (
          <option key={m}>{m}</option>
        ))}
      </select>
    </label>
  );
  const payDate = (
    <label>
      Data de pagamento
      <input
        type="date"
        name="paidOn"
        required
        defaultValue={localDate(now)}
        max={localDate(now)}
      />
    </label>
  );
  return (
    <div className="fin">
      <header>
        <div>
          <h1>{reports ? "Relatórios" : "Financeiro"}</h1>
          <p>
            {reports
              ? "Resultados e movimentações de " + tenantName
              : "Acompanhe o caixa, os recebimentos e as despesas."}
          </p>
        </div>
        <div className="fin-actions">
          {reports ? (
            <>
              <button disabled={!data} onClick={download}>
                <Download size={16} />
                Exportar CSV
              </button>
              <button disabled={!data} onClick={() => window.print()}>
                <Printer size={16} />
                Imprimir / PDF
              </button>
            </>
          ) : (
            <>
              <button disabled={!data} onClick={() => open("expense")}>
                Nova despesa
              </button>
              <button
                className="primary"
                disabled={!data?.bookings.length}
                onClick={() => open("income")}
              >
                <Plus size={16} /> Registrar recebimento
              </button>
            </>
          )}
        </div>
      </header>
      {!reports&&<ManualReceipt onSaved={()=>setRefresh(v=>v+1)}/>}
      {dates}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!data && !error && <p>Carregando movimentações…</p>}
      {totals && data && (
        <>
          <section className="fin-kpis">
            {[
              { name: "Receita recebida", v: totals.net, Icon: ArrowDownLeft },
              { name: "Despesas pagas", v: totals.paid, Icon: ArrowUpRight },
              { name: "Resultado de caixa", v: totals.cash, Icon: Wallet },
              {
                name: "A receber no período",
                v: totals.pending,
                Icon: CircleDollarSign,
              },
            ].map(({ name, v, Icon }) => (
              <article key={name}>
                <Icon size={19} />
                <span>{name}</span>
                <strong>{money(v)}</strong>
              </article>
            ))}
          </section>
          {reports && <FinanceCharts data={data} from={from} to={to} />}
          {reports && (
            <section className="fin-box">
              <h2>Resumo do período</h2>
              <dl>
                {Object.entries({
                  "Receita líquida por atendimento concluído": totals.accrued,
                  "Resultado operacional (por vencimento)":
                    totals.operatingResult,
                  "Recebimentos brutos": totals.gross,
                  Estornos: totals.refunds,
                  "Descontos concedidos": totals.discount,
                  "Valor dos agendamentos": totals.forecast,
                  "Ticket médio dos atendimentos concluídos": totals.ticket,
                  "Despesas por vencimento": totals.operating,
                  "Contas a pagar por vencimento": totals.payable,
                  "Comissões geradas": data.commissions,
                }).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{money(v)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          <section className="fin-box">
            <div className="fin-tabs">
              <button
                aria-pressed={tab === "receipts"}
                onClick={() => setTab("receipts")}
              >
                Recebimentos
              </button>
              <button
                aria-pressed={tab === "expenses"}
                onClick={() => setTab("expenses")}
              >
                Despesas
              </button>
            </div>
            {tab === "receipts" ? (
              <table>
                <thead>
                  <tr>
                    {["Data", "Atendimento", "Movimento", "Forma", "Valor"].map(
                      (x) => (
                        <th key={x}>{x}</th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((e) => (
                    <tr key={e.id}>
                      <td>{day(e.local_time)}</td>
                      <td>
                        {e.service}
                        <small>
                          {e.customer} · {e.professional}
                        </small>
                      </td>
                      <td>{kinds[e.kind]}</td>
                      <td>{e.method}</td>
                      <td>{money(e.amount_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table>
                <thead>
                  <tr>
                    {[
                      "Vencimento",
                      "Descrição",
                      "Categoria",
                      "Pagamento",
                      "Valor",
                      "",
                    ].map((x) => (
                      <th key={x}>{x}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.expenses.map((e) => (
                    <tr key={e.id}>
                      <td>{day(e.due_date)}</td>
                      <td>
                        {e.description}
                        {e.installment && (
                          <small>Recorrente · parcela {e.installment}</small>
                        )}
                      </td>
                      <td>{e.category}</td>
                      <td>{e.paid_on ? day(e.paid_on) : "Pendente"}</td>
                      <td>{money(e.amount_cents)}</td>
                      <td>
                        {!reports && !e.paid_on && (
                          <button onClick={() => open("settle", e)}>
                            Dar baixa
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!(tab === "receipts" ? data.entries : data.expenses).length && (
              <p className="fin-empty">Nenhum lançamento neste período.</p>
            )}
          </section>
        </>
      )}
      <dialog
        ref={dialog}
        onCancel={(e) => {
          if (busy) e.preventDefault();
          else setMode(null);
        }}
      >
        <form key={mode} onSubmit={submit}>
          <h2>
            {mode === "income"
              ? "Registrar movimento"
              : mode === "expense"
                ? "Nova despesa"
                : "Baixa de despesa"}
          </h2>
          {mode === "income" && (
            <>
              <label>
                Atendimento
                <select required name="booking">
                  {data?.bookings.map((b) => (
                    <option key={b.id} value={b.id}>
                      {new Date(b.starts_at).toLocaleString("pt-BR", {
                        timeZone: data.timezone,
                      })}{" "}
                      · {b.customer} · {b.service}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Movimento
                <select name="kind">
                  {Object.entries(kinds).map(([k, v]) => (
                    <option value={k} key={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              {method}
            </>
          )}
          {mode === "expense" && (
            <>
              <label>
                Descrição
                <input required name="description" maxLength={200} />
              </label>
              <label>
                Categoria
                <select name="category">
                  {categories.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                Vencimento
                <input
                  required
                  type="date"
                  name="due"
                  defaultValue={localDate(now)}
                />
              </label>
            </>
          )}
          {mode !== "settle" && (
            <label>
              Valor (R$)
              <input
                name="amount"
                type="number"
                inputMode="decimal"
                min="0.01"
                max="999999999.99"
                required
                step="0.01"
              />
            </label>
          )}
          {mode === "expense" && (
            <>
              <label>
                Repetição
                <select
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value)}
                >
                  <option value="once">Uma vez</option>
                  <option value="weekly">Semanal</option>
                  <option value="monthly">Mensal</option>
                  <option value="yearly">Anual</option>
                </select>
              </label>
              {frequency !== "once" && (
                <label>
                  Número de lançamentos
                  <input
                    required
                    name="occurrences"
                    type="number"
                    min={2}
                    max={120}
                    defaultValue={12}
                  />
                </label>
              )}
            </>
          )}
          {mode === "expense" && (
            <label className="fin-check">
              <input
                type="checkbox"
                checked={paid}
                onChange={(e) => setPaid(e.target.checked)}
              />
              {frequency === "once" ? "Despesa paga" : "Primeira parcela paga"}
            </label>
          )}
          {(mode === "settle" || (mode === "expense" && paid)) && (
            <>
              {payDate}
              {method}
            </>
          )}
          {formError && <p role="alert">{formError}</p>}
          <div className="fin-actions">
            <button disabled={busy} type="button" onClick={() => setMode(null)}>
              Cancelar
            </button>
            <button disabled={busy} className="primary">
              {busy ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
