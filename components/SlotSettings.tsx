"use client";
import { useEffect, useState } from "react";
import { db } from "@/lib/db";
import { useTenant } from "@/lib/tenant";
const days = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
];
export default function SlotSettings() {
  const { tenantId } = useTenant(),
    [date, setDate] = useState(
      new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }),
    ),
    [slots, setSlots] = useState<string[]>([]),
    [newTime, setNewTime] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    async function load() {
      const result = await db()
        .from("date_slots")
        .select("times")
        .eq("tenant_id", tenantId)
        .eq("day", date)
        .maybeSingle();
      if (!active) return;
      if (result.data)
        setSlots(result.data.times.map((x: string) => x.slice(0, 5)));
      else {
        const w = new Date(date + "T12:00:00").getDay();
        const fallback = await db()
          .from("daily_slots")
          .select("at_time")
          .eq("tenant_id", tenantId)
          .eq("weekday", w)
          .order("at_time");
        if (active)
          setSlots((fallback.data || []).map((x) => x.at_time.slice(0, 5)));
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [tenantId, date]);
  async function save(times: string[]) {
    const previous = slots;
    setSlots(times);
    setMessage("Salvando…");
    const { error } = await db()
      .from("date_slots")
      .upsert(
        { tenant_id: tenantId, day: date, times },
        { onConflict: "tenant_id,day" },
      );
    if (error) {
      setSlots(previous);
      setMessage(error.message);
    } else
      setMessage(
        "Horários publicados para " + date.split("-").reverse().join("/"),
      );
  }
  return (
    <section className="slot-settings">
      <div>
        <small>AGENDA PÚBLICA</small>
        <h2>Horários disponíveis</h2>
        <p>
          Escolha um dia e cadastre as horas que seus clientes poderão reservar.
          Cada hora aceita uma marcação.
        </p>
      </div>
      <label>
        Data da agenda
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      <div className="slot-list">
        {slots.map((time) => (
          <span key={time}>
            {time}
            <button
              aria-label={"Remover " + time}
              onClick={() => save(slots.filter((x) => x !== time))}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (newTime && !slots.includes(newTime)) {
            void save([...slots, newTime].sort());
            setNewTime("");
          }
        }}
      >
        <label>
          Adicionar horário
          <input
            type="time"
            required
            value={newTime}
            onChange={(e) => setNewTime(e.target.value)}
          />
        </label>
        <button>Adicionar</button>
      </form>
      <p role="status">{message}</p>
    </section>
  );
}
