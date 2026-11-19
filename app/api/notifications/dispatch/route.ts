import { createClient } from "@supabase/supabase-js";
import { timingSafeEqual } from "node:crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Job = {
  id: string;
  lease: string;
  channel: "email" | "whatsapp";
  attempt: number;
  destination: string | null;
  company: string;
  service: string;
  professional: string;
  local_start: string;
};
type Delivery = {
  state: "queued" | "failed" | "accepted" | "uncertain";
  reference?: string;
  error?: string;
};
const env = process.env;
function authorized(request: Request) {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from("Bearer " + secret),
    actual = Buffer.from(request.headers.get("authorization") ?? "");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
async function deliver(job: Job): Promise<Delivery> {
  if (!job.destination)
    return { state: "failed", error: "missing_destination" };
  const email = job.channel === "email";
  let destination = job.destination;
  if (!email && destination.length <= 11) destination = "55" + destination;
  const url = email
    ? "https://api.resend.com/emails"
    : `https://graph.facebook.com/${env.WHATSAPP_GRAPH_VERSION}/${env.WHATSAPP_PHONE_ID}/messages`;
  const body = email
    ? {
        from: env.RESEND_FROM,
        to: [destination],
        subject: "Comprovante de agendamento",
        text: [
          job.company,
          job.service,
          job.professional,
          job.local_start,
        ].join("\n"),
      }
    : {
        messaging_product: "whatsapp",
        to: destination,
        type: "template",
        template: {
          name: env.WHATSAPP_TEMPLATE,
          language: { code: "pt_BR" },
          components: [
            {
              type: "body",
              parameters: [
                job.company,
                job.service,
                job.professional,
                job.local_start,
              ].map((text) => ({ type: "text", text })),
            },
          ],
        },
      };
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization:
          "Bearer " + (email ? env.RESEND_API_KEY : env.WHATSAPP_ACCESS_TOKEN),
        "Content-Type": "application/json",
        ...(email ? { "Idempotency-Key": "booking-" + job.id } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(9000),
      cache: "no-store",
    });
    if (response.ok) {
      const result = await response.json();
      const ref = email ? result.id : result.messages?.[0]?.id;
      return ref
        ? { state: "accepted", reference: ref }
        : { state: "uncertain", error: "missing_provider_reference" };
    }
    const code = "http_" + response.status;
    if (response.status === 429) return { state: "queued", error: code };
    if (response.status >= 500)
      return { state: email ? "queued" : "uncertain", error: code };
    return { state: "failed", error: code };
  } catch {
    return {
      state: email ? "queued" : "uncertain",
      error: "provider_connection",
    };
  }
}
export async function GET(request: Request) {
  if (!authorized(request)) return new Response(null, { status: 401 });
  const channels = [];
  if (env.RESEND_API_KEY && env.RESEND_FROM) channels.push("email");
  if (
    env.WHATSAPP_ACCESS_TOKEN &&
    /^\d+$/.test(env.WHATSAPP_PHONE_ID ?? "") &&
    /^v\d+\.\d+$/.test(env.WHATSAPP_GRAPH_VERSION ?? "") &&
    env.WHATSAPP_TEMPLATE
  )
    channels.push("whatsapp");
  const api = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL!,
    env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await api.rpc("claim_deliveries", {
    p_channels: channels,
  });
  if (error)
    return Response.json(
      { error: "Falha ao consultar a fila." },
      { status: 503 },
    );
  const results = await Promise.all(
    (data as Job[]).map(async (job) => {
      const result = await deliver(job);
      const { error } = await api.rpc("finish_delivery", {
        p_id: job.id,
        p_lease: job.lease,
        p_state: result.state,
        p_reference: result.reference ?? null,
        p_error: result.error ?? null,
      });
      return !error;
    }),
  );
  return Response.json(
    { processed: results.length },
    {
      status: results.every(Boolean) ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
