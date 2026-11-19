import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .max(80);
const uuid = z.uuid();
const moment = z.iso.datetime({ offset: true });
const endpoints = {
  simple_schedule: z.strictObject({ p_slug: slug, p_day: z.iso.date() }),
  simple_book: z.strictObject({
    p_slug: slug,
    p_day: z.iso.date(),
    p_service: uuid.nullable().optional(),
    p_time: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/),
    p_name: z.string().trim().min(2).max(120),
    p_phone: z.string().min(10).max(24),
    p_notes: z.string().max(1500),
    p_key: uuid,
    p_token: uuid,
  }),
  booking_catalog: z.strictObject({ p_slug: slug }),
  booking_slots: z.strictObject({
    p_slug: slug,
    p_service: uuid,
    p_day: z.iso.date(),
    p_professional: uuid.nullable(),
  }),
  booking_create: z.strictObject({
    p_slug: slug,
    p_service: uuid,
    p_professional: uuid,
    p_start: moment,
    p_name: z.string().trim().min(2).max(120),
    p_phone: z.string().min(10).max(24),
    p_email: z.union([z.email().max(254), z.literal("")]),
    p_notes: z.string().max(1500),
    p_key: uuid,
    p_token: uuid,
    p_notify_email: z.boolean(),
    p_notify_whatsapp: z.boolean(),
  }),
  booking_receipt: z.strictObject({ p_token: uuid }),
  customer_update_booking: z.strictObject({
    p_token: uuid,
    p_start: moment.nullable(),
    p_professional: uuid.nullable(),
  }),
};
const json = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      ...(status === 429 ? { "Retry-After": "60" } : {}),
    },
  });
async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Buffer[] = [];
  let length = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.byteLength;
    if (length > 16384) {
      await reader.cancel();
      throw Error("size");
    }
    chunks.push(Buffer.from(chunk.value));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function POST(request: Request) {
  const name = new URL(request.url).searchParams.get("op") ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!key || !url)
    return json({ error: "Agendamento temporariamente indisponível." }, 503);
  // Vercel supplies its own forwarding header. Other hosts share one bucket
  // unless their ingress explicitly strips and overwrites a configured header.
  const header =
    process.env.VERCEL === "1"
      ? "x-vercel-forwarded-for"
      : process.env.TRUSTED_CLIENT_IP_HEADER;
  const forwarded = header
    ? request.headers.get(header)?.split(",")[0]?.trim()
    : "";
  const origin = createHmac("sha256", key)
    .update(forwarded && isIP(forwarded) ? forwarded : "shared")
    .digest("hex");
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const write =
    name === "booking_create" ||
    name === "simple_book" ||
    name === "customer_update_booking";
  const limit = await client.rpc("reserve_request_quota", {
    p_origin: origin,
    p_write: write,
  });
  if (limit.error)
    return json({ error: "Agendamento temporariamente indisponível." }, 503);
  if (!limit.data)
    return json(
      { error: "Muitas solicitações. Tente novamente em um minuto." },
      429,
    );
  if (!Object.hasOwn(endpoints, name))
    return json({ error: "Operação desconhecida." }, 404);
  let body: unknown;
  try {
    body = await readBody(request);
  } catch {
    return json({ error: "Requisição inválida." }, 400);
  }
  const parsed = endpoints[name as keyof typeof endpoints].safeParse(body);
  if (!parsed.success)
    return json({ error: "Revise os dados informados." }, 400);
  const result = await client.rpc(name, parsed.data);
  if (result.error) {
    const messages = [
      "Este horário ficou indisponível.",
      "Horário ocupado",
      "Horário indisponível",
      "Dados inválidos",
      "Limite de reservas",
      "Limite de reservas atingido. Tente mais tarde.",
      "Revise os dados de contato.",
      "A reserva já foi encerrada.",
      "Horário indisponível.",
      "Limite de remarcações atingido. Entre em contato com o estabelecimento.",
    ];
    return json(
      {
        error: messages.includes(result.error.message)
          ? result.error.message
          : "Operação indisponível. Consulte os horários e tente novamente.",
      },
      409,
    );
  }
  return json({ data: result.data });
}
