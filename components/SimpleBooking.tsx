"use client";
import { useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  Clock3,
  MapPin,
  ArrowRight,
  Check,
  MessageCircle,
} from "lucide-react";
import "./simple-booking.css";
type Info = {
  services: { id: string; name: string; price: number | null }[];
  name: string;
  slug: string;
  timezone: string;
  description: string;
  address: string;
  logo: string;
  cover: string;
  color: string;
  slots: { time: string; busy: boolean }[];
};
const today = () =>
  new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
export default function SimpleBooking({ slug }: { slug: string }) {
  const [date, setDate] = useState(today()),
    [info, setInfo] = useState<Info | null>(null),
    [service, setService] = useState(""),
    [chosen, setChosen] = useState(""),
    [name, setName] = useState(""),
    [phone, setPhone] = useState(""),
    [notes, setNotes] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const keys = useRef<{ key: string; token: string } | null>(null);
  async function call(op: string, data: object) {
    const res = await fetch("/api/reservas?op=" + op, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw Error(json.error || "Não foi possível completar.");
    return json.data;
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    setChosen("");
    call("simple_schedule", { p_slug: slug, p_day: date })
      .then((v) => {
        if (active) {
          setInfo(v);
          setService((current) =>
            v.services.some((x: { id: string }) => x.id === current)
              ? current
              : v.services[0]?.id || "",
          );
          setLoading(false);
          setError("");
        }
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [slug, date]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!chosen || busy) return;
    setBusy(true);
    setError("");
    keys.current ??= { key: crypto.randomUUID(), token: crypto.randomUUID() };
    try {
      await call("simple_book", {
        p_slug: slug,
        p_day: date,
        p_service: service,
        p_time: chosen,
        p_name: name,
        p_phone: phone,
        p_notes: notes,
        p_key: keys.current.key,
        p_token: keys.current.token,
      });
      sessionStorage.setItem("turno-whatsapp-" + keys.current.token, "1");
      location.assign("/reserva/" + keys.current.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao agendar");
      setBusy(false);
    }
  }
  return (
    <main
      className="simple-book"
      style={
        {
          "--booking-accent":
            info?.color && /^#[0-9a-f]{6}$/i.test(info.color)
              ? info.color
              : "#624bd7",
        } as React.CSSProperties
      }
    >
      <div className="simple-wrap">
        <nav>
          <span className="simple-brand">
            <CalendarDays size={21} /> Turno
          </span>
          <span>Agendamento online</span>
        </nav>
        <div className="simple-hero">
          {info?.cover?.startsWith("https://") && (
            <img src={info.cover} alt="" />
          )}
          <div className="simple-hero-content">
            {info?.logo?.startsWith("https://") ? (
              <img className="simple-logo" src={info.logo} alt="Logo" />
            ) : (
              <span className="simple-logo">
                <CalendarDays />
              </span>
            )}
            <p className="simple-kicker">RESERVE SEU HORÁRIO</p>
            <h1>{info?.name || "Agenda online"}</h1>
            <p>
              {info?.description ||
                "Escolha um horário e confirme em poucos passos."}
            </p>
            {info?.address && (
              <span>
                <MapPin size={15} />
                {info.address}
              </span>
            )}
          </div>
        </div>
        <div className="simple-grid">
          <section className="simple-card">
            <div className="simple-section-title">
              <span>
                <CalendarDays size={19} />
              </span>
              <div>
                <small>01 / ESCOLHA O DIA</small>
                <h2>Qual dia fica melhor?</h2>
              </div>
            </div>
            <label className="service-select">
              Tipo de serviço
              <select
                value={service}
                required
                onChange={(e) => setService(e.target.value)}
              >
                {info?.services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.price != null
                      ? " — " +
                        (s.price / 100).toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        })
                      : ""}
                  </option>
                ))}
              </select>
            </label>
            <input
              aria-label="Data do agendamento"
              type="date"
              min={today()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <div className="simple-section-title">
              <span>
                <Clock3 size={19} />
              </span>
              <div>
                <small>02 / ESCOLHA A HORA</small>
                <h2>Horários do dia</h2>
              </div>
            </div>
            <p className="simple-tip">
              Os horários ocupados aparecem para você acompanhar a agenda.
            </p>
            {loading ? (
              <p>Carregando horários…</p>
            ) : (
              <div className="simple-slots">
                {info?.slots.length ? (
                  info.slots.map((s) => (
                    <button
                      key={s.time}
                      type="button"
                      disabled={s.busy}
                      className={chosen === s.time ? "selected" : ""}
                      onClick={() => setChosen(s.time)}
                    >
                      {s.time}
                      <small>
                        {s.busy
                          ? "Ocupado"
                          : chosen === s.time
                            ? "Selecionado"
                            : "Disponível"}
                      </small>
                    </button>
                  ))
                ) : (
                  <p>Sem horários cadastrados para este dia.</p>
                )}
              </div>
            )}
          </section>
          <section className="simple-card">
            <div className="simple-section-title">
              <span>
                <Check size={19} />
              </span>
              <div>
                <small>03 / CONFIRMAÇÃO</small>
                <h2>Seus dados</h2>
              </div>
            </div>
            <form onSubmit={submit}>
              <label>
                Nome completo
                <input
                  required
                  minLength={2}
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Como podemos chamar você?"
                />
              </label>
              <label>
                WhatsApp com DDD
                <input
                  required
                  type="tel"
                  minLength={10}
                  maxLength={24}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(00) 00000-0000"
                />
              </label>
              <label>
                Observações (opcional)
                <textarea
                  maxLength={1500}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Algo que precisamos saber?"
                />
              </label>
              <div className="simple-review">
                <b>
                  {chosen
                    ? date.split("-").reverse().join("/") + " às " + chosen
                    : "Escolha um horário ao lado"}
                </b>
                <span>{info?.name}</span>
              </div>
              <p className="simple-privacy">
                Seus dados serão usados para organizar e confirmar este
                agendamento.
              </p>
              {error && (
                <p role="alert" className="simple-error">
                  {error}
                </p>
              )}
              <button className="simple-submit" disabled={!chosen || busy}>
                {busy ? "Confirmando…" : "Confirmar agendamento"}
                <ArrowRight size={18} />
              </button>
            </form>
          </section>
        </div>
        <footer>
          Agendamento com <strong>Turno</strong>
        </footer>
      </div>
    </main>
  );
}
