"use client";
import { useEffect, useState, useRef } from "react";
import type { FormEvent } from "react";
import "./booking.css";

type Prof = { id: string; name: string };
type Service = {
  id: string;
  name: string;
  description: string;
  price: number | null;
  minutes: number;
  image?: string;
  professionals: Prof[];
};
type Catalog = {
  name: string;
  timezone: string;
  slug: string;
  services: Service[];
  description: string;
  address: string;
  whatsapp: string;
  instagram: string;
  logo_url: string;
  cover_url: string;
  brand_color: string;
  policy: string;
  max_days: number;
  hours: { day: number; open: string; close: string }[];
};
type Slot = { starts_at: string; professional_id: string };
type Rec = {
  id: string;
  status: string;
  starts_at: string;
  ends_at: string;
  price: number | null;
  service: string;
  professional: string;
  tenant: string;
  timezone: string;
  slug: string;
  service_id: string;
  professional_id: string;
  policy: string;
  customer_name?:string;
  customer_phone?:string;
};
const money = (v: number | null) =>
  v === null
    ? "Sob consulta"
    : (v / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const clock = (v: string, z: string) =>
  new Date(v).toLocaleTimeString("pt-BR", {
    timeZone: z,
    hour: "2-digit",
    minute: "2-digit",
  });
const day = (z: string) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: z }).format(new Date());
const when = (v: string, z: string) =>
  new Date(v).toLocaleString("pt-BR", {
    timeZone: z,
    dateStyle: "long",
    timeStyle: "short",
  });
const safeUrl = (v?: string) => (v && /^https:\/\//i.test(v) ? v : undefined);
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/reservas?op=" + encodeURIComponent(name), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
    cache: "no-store",
    credentials: "omit",
  });
  const payload = await response.json();
  if (!response.ok) throw Error(payload.error || "Falha ao acessar a reserva.");
  return payload.data as T;
}
function errorText(e: unknown) {
  return e instanceof Error ? e.message : "Falha ao acessar o sistema.";
}
function SlotPicker({
  slug,
  service,
  prof,
  zone,
  onPick,
}: {
  slug: string;
  service: string;
  prof: string;
  zone: string;
  onPick: (s: Slot) => void;
}) {
  const [date, setDate] = useState(day(zone)),
    [slots, setSlots] = useState<Slot[]>([]),
    [msg, setMsg] = useState("");
  useEffect(() => {
    let current = true;
    setSlots([]);
    setMsg("Consultando horários…");
    rpc<Slot[]>("booking_slots", {
      p_slug: slug,
      p_service: service,
      p_professional: prof || null,
      p_day: date,
    })
      .then((rows) => {
        if (current) {
          setSlots(
            rows.filter((s, i) => !i || rows[i - 1].starts_at !== s.starts_at),
          );
          setMsg(rows.length ? "" : "Nenhum horário disponível nesta data.");
        }
      })
      .catch((e) => current && setMsg(errorText(e)));
    return () => {
      current = false;
    };
  }, [slug, service, date, prof]);
  return (
    <>
      <label>
        Data
        <input
          type="date"
          min={day(zone)}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      <p aria-live="polite">{msg}</p>
      <div className="bkSlots">
        {slots.map((s) => (
          <button type="button" key={s.starts_at} onClick={() => onPick(s)}>
            {clock(s.starts_at, zone)}
          </button>
        ))}
      </div>
    </>
  );
}
export function PublicBooking({ slug }: { slug: string }) {
  const [cat, setCat] = useState<Catalog | null>(null),
    [err, setErr] = useState(""),
    [service, setService] = useState<Service | null>(null),
    [prof, setProf] = useState(""),
    [slot, setSlot] = useState<Slot | null>(null),
    [busy, setBusy] = useState(false),
    [review, setReview] = useState(false);
  const [emailNotice, setEmailNotice] = useState(false),
    [whatsappNotice, setWhatsappNotice] = useState(false);
  const [contact, setContact] = useState({
      name: "",
      phone: "",
      email: "",
      notes: "",
    }),
    keys = useRef<{ key: string; token: string } | null>(null);
  useEffect(() => {
    let ok = true;
    rpc<Catalog>("booking_catalog", { p_slug: slug })
      .then((v) => {
        if (ok) {
          setCat(v);
          if (!v) setErr("Empresa indisponível.");
        }
      })
      .catch((e) => ok && setErr(errorText(e)));
    return () => {
      ok = false;
    };
  }, [slug]);
  async function confirm() {
    if (!service || !slot || busy) return;
    setBusy(true);
    setErr("");
    keys.current ??= { key: crypto.randomUUID(), token: crypto.randomUUID() };
    try {
      await rpc("booking_create", {
        p_slug: slug,
        p_service: service.id,
        p_professional: slot.professional_id,
        p_start: slot.starts_at,
        p_name: contact.name,
        p_phone: contact.phone,
        p_email: contact.email,
        p_notes: contact.notes,
        p_key: keys.current.key,
        p_token: keys.current.token,
        p_notify_email: emailNotice && Boolean(contact.email),
        p_notify_whatsapp: whatsappNotice,
      });
      location.assign("/reserva/" + keys.current.token);
    } catch (e) {
      setErr(errorText(e));
      setBusy(false);
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    setReview(true);
  }
  return (
    <main className="booking">
      <section className="bkPanel">
        {cat && (
          <>
            <header
              style={{
                borderColor: /^#[0-9a-f]{6}$/i.test(cat.brand_color)
                  ? cat.brand_color
                  : undefined,
              }}
            >
              {safeUrl(cat.cover_url) && (
                <img className="bkCover" src={cat.cover_url} alt="" />
              )}
              {safeUrl(cat.logo_url) && (
                <img width="60" height="60" src={cat.logo_url} alt="" />
              )}
              <h1>{cat.name}</h1>
              <p>{cat.description}</p>
              <p>{cat.address}</p>
              {cat.whatsapp && (
                <a href={"https://wa.me/" + cat.whatsapp.replace(/\D/g, "")}>
                  WhatsApp
                </a>
              )}{" "}
              {cat.instagram && (
                <a
                  href={
                    "https://instagram.com/" +
                    cat.instagram
                      .replace(/^.*instagram\.com\//, "")
                      .replace(/[^\w.]/g, "")
                  }
                >
                  Instagram
                </a>
              )}
              {cat.hours.length > 0 && (
                <details>
                  <summary>Horários de funcionamento</summary>
                  {cat.hours.map((h, i) => (
                    <p key={i}>
                      {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"][h.day]}{" "}
                      · {h.open.slice(0, 5)} – {h.close.slice(0, 5)}
                    </p>
                  ))}
                </details>
              )}
            </header>
            {!service ? (
              <>
                <h2>Escolha seu serviço</h2>
                {!cat.services.length && <p>Sem serviços disponíveis.</p>}
                {cat.services.map((s) => (
                  <article key={s.id}>
                    {safeUrl(s.image) && (
                      <img width="80" src={s.image} alt="" />
                    )}
                    <h3>{s.name}</h3>
                    <p>{s.description}</p>
                    <strong>
                      {money(s.price)} · {s.minutes} min
                    </strong>
                    <p>{s.professionals.map((p) => p.name).join(", ")}</p>
                    <button
                      disabled={!s.professionals.length}
                      onClick={() => {
                        setService(s);
                        setProf("");
                      }}
                    >
                      Agendar
                    </button>
                  </article>
                ))}
              </>
            ) : (
              <>
                <button
                  className="bkBack"
                  disabled={busy}
                  onClick={() => {
                    setErr("");
                    if (review) setReview(false);
                    else if (slot) setSlot(null);
                    else setService(null);
                  }}
                >
                  ← Voltar
                </button>
                <h2>
                  {review
                    ? "Revise sua reserva"
                    : slot
                      ? "Seus dados"
                      : service.name}
                </h2>
                {!slot ? (
                  <>
                    <label>
                      Profissional
                      <select
                        value={prof}
                        onChange={(e) => setProf(e.target.value)}
                      >
                        <option value="">
                          Qualquer profissional disponível
                        </option>
                        {service.professionals.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <SlotPicker
                      slug={slug}
                      service={service.id}
                      prof={prof}
                      zone={cat.timezone}
                      onPick={setSlot}
                    />
                  </>
                ) : (
                  <>
                    <article>
                      <strong>{service.name}</strong>
                      <p>
                        {
                          service.professionals.find(
                            (p) => p.id === slot.professional_id,
                          )?.name
                        }
                      </p>
                      <p>
                        {when(slot.starts_at, cat.timezone)} · {service.minutes}{" "}
                        min
                      </p>
                      {money(service.price)}
                    </article>
                    {review ? (
                      <>
                        <p>
                          {contact.name} · {contact.phone}
                        </p>
                        <button disabled={busy} onClick={confirm}>
                          {busy ? "Confirmando…" : "Confirmar agendamento"}
                        </button>
                      </>
                    ) : (
                      <form onSubmit={submit}>
                        {(["name", "phone", "email", "notes"] as const).map(
                          (k, i) => (
                            <label key={k}>
                              {
                                [
                                  "Nome completo",
                                  "WhatsApp com DDD",
                                  "E-mail (opcional)",
                                  "Observações (opcional)",
                                ][i]
                              }
                              <input
                                type={["text", "tel", "email", "text"][i]}
                                required={i < 2}
                                minLength={i === 0 ? 2 : undefined}
                                maxLength={[120, 22, 254, 1500][i]}
                                value={contact[k]}
                                onChange={(e) =>
                                  setContact({
                                    ...contact,
                                    [k]: e.target.value,
                                  })
                                }
                              />
                            </label>
                          ),
                        )}
                        {contact.email && (
                          <label className="bkCheck">
                            <input
                              type="checkbox"
                              checked={emailNotice}
                              onChange={(e) => setEmailNotice(e.target.checked)}
                            />
                            Aceito receber o comprovante por e-mail, quando
                            disponível.
                          </label>
                        )}
                        <label className="bkCheck">
                          <input
                            type="checkbox"
                            checked={whatsappNotice}
                            onChange={(e) =>
                              setWhatsappNotice(e.target.checked)
                            }
                          />
                          Aceito receber o comprovante por WhatsApp, quando
                          disponível.
                        </label>
                        <p>
                          O estabelecimento usará seus dados para organizar o
                          atendimento e entrar em contato sobre esta reserva.
                        </p>
                        {cat.policy && <p>{cat.policy}</p>}
                        <button>Revisar agendamento</button>
                      </form>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}
        {err && <p role="alert">{err}</p>}
        {!cat && !err && "Carregando serviços…"}
      </section>
    </main>
  );
}
export function Receipt({ token }: { token: string }) {
  const [r, setR] = useState<Rec | null>(null),
    [err, setErr] = useState(""),
    [mode, setMode] = useState(""),
    [slot, setSlot] = useState<Slot | null>(null),
    [busy, setBusy] = useState(false);
  async function refresh() {
    const receipt = await rpc<Rec>("booking_receipt", { p_token: token });
    if (!receipt) throw Error("Comprovante indisponível.");
    setR(receipt);
    const auto=sessionStorage.getItem("turno-whatsapp-"+token);
    if(auto){sessionStorage.removeItem("turno-whatsapp-"+token);location.assign("https://wa.me/5579999009358?text="+encodeURIComponent("Agendamento confirmado e registrado no Turno!\nEmpresa: "+receipt.tenant+"\nCliente: "+(receipt.customer_name||"")+"\nWhatsApp: "+(receipt.customer_phone||"")+"\nServiço: "+receipt.service+"\nData: "+when(receipt.starts_at,receipt.timezone)+"\nValor: "+money(receipt.price)+"\nCódigo: "+receipt.id));}

  }
  useEffect(() => {
    refresh().catch((e) => setErr(errorText(e)));
  }, [token]);
  async function update() {
    setBusy(true);
    setErr("");
    try {
      await rpc("customer_update_booking", {
        p_token: token,
        p_start: slot?.starts_at ?? null,
        p_professional: slot?.professional_id ?? null,
      });
      await refresh();
      setMode("");
      setSlot(null);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  const statuses: Record<string, string> = {
    pending: "Pendente",
    confirmed: "Confirmado",
    in_progress: "Em atendimento",
    completed: "Concluído",
    cancelled: "Cancelado",
    no_show: "Não compareceu",
  };
  return (
    <main className="booking">
      <section className="bkPanel">
        {r ? (
          <>
            <header>
              <h1>Comprovante de reserva</h1>
              <p>{r.tenant}</p>
            </header>
            <article>
              <strong>{statuses[r.status]}</strong>
              <h2>{r.service}</h2>
              <p>{r.professional}</p>
              <p>{when(r.starts_at, r.timezone)}</p>
              <p>
                {money(r.price)}
              </p>
              <small>Reserva {r.id}</small>
            </article>
            <p>
              Guarde este link privado para consultar ou alterar sua reserva.
            </p>
            {r.policy && <p>{r.policy}</p>}
            {r.status!=="cancelled"&&<a className="bkWhatsApp" target="_blank" rel="noopener noreferrer" href={"https://wa.me/5579999009358?text="+encodeURIComponent("Novo agendamento no Turno!\nEmpresa: "+r.tenant+"\nCliente: "+(r.customer_name||"Cliente")+"\nWhatsApp: "+(r.customer_phone||"Não informado")+"\nDia e hora: "+when(r.starts_at,r.timezone)+"\nReserva: "+r.id)}>Enviar confirmação pelo WhatsApp</a>}
            <div className="bkActions">
              <button onClick={() => window.print()}>
                Imprimir comprovante
              </button>
              {["pending", "confirmed"].includes(r.status) &&
                Date.parse(r.starts_at) > Date.now() && (
                  <>
                    <button
                      onClick={() => {
                        setSlot(null);
                        setMode("move");
                      }}
                    >
                      Remarcar
                    </button>
                    <button
                      onClick={() => {
                        setSlot(null);
                        setMode("cancel");
                      }}
                    >
                      Cancelar reserva
                    </button>
                  </>
                )}
            </div>
            {mode === "move" && (
              <SlotPicker
                slug={r.slug}
                service={r.service_id}
                prof={r.professional_id}
                zone={r.timezone}
                onPick={setSlot}
              />
            )}{" "}
            {(mode === "cancel" || slot) && (
              <article>
                <p>
                  {slot
                    ? when(slot.starts_at, r.timezone)
                    : "Deseja cancelar sua reserva?"}
                </p>
                <button disabled={busy} onClick={update}>
                  {slot ? "Confirmar remarcação" : "Confirmar cancelamento"}
                </button>{" "}
                <button
                  onClick={() => {
                    setSlot(null);
                    setMode("");
                  }}
                >
                  Voltar
                </button>
              </article>
            )}
          </>
        ) : (
          !err && "Consultando reserva…"
        )}
        {err && <p role="alert">{err}</p>}
      </section>
    </main>
  );
}
