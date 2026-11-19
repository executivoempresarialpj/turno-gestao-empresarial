import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// Opt-in only. Run against the disposable Supabase project described in README.
test(
  "GoTrue invite, recovery, tenant activation and Realtime notification",
  {
    skip: process.env.TEST_SUPABASE_SMOKE !== "disposable",
    timeout: 70_000,
  },
  async () => {
    const env = process.env;
    for (const key of [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "TEST_OPERATOR_EMAIL",
      "TEST_OPERATOR_PASSWORD",
    ]) {
      assert.ok(env[key], key);
    }
    const makeClient = (key) =>
      createClient(env.NEXT_PUBLIC_SUPABASE_URL, key, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    const service = makeClient(env.SUPABASE_SERVICE_ROLE_KEY);
    const operator = makeClient(env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const invited = makeClient(env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const unwrap = async (promise) => {
      const { data, error } = await promise;
      if (error) throw error;
      return data;
    };
    const tenant = await unwrap(
      service
        .from("tenants")
        .select("id,timezone")
        .eq("slug", "demonstracao-local")
        .single(),
    );
    const address = "agenda-qa-" + randomUUID() + "@example.test";
    const password = randomUUID() + randomUUID();
    let userId, channel, token, subscriptionTimeout;
    try {
      await unwrap(
        operator.auth.signInWithPassword({
          email: env.TEST_OPERATOR_EMAIL,
          password: env.TEST_OPERATOR_PASSWORD,
        }),
      );
      await unwrap(
        operator.rpc("platform_invite", {
          t: tenant.id,
          p_email: address,
          p_role: "admin",
        }),
      );
      const invitation = await unwrap(
        service.auth.admin.generateLink({ type: "invite", email: address }),
      );
      userId = invitation.user.id;
      await unwrap(
        invited.auth.verifyOtp({
          type: "invite",
          token_hash: invitation.properties.hashed_token,
        }),
      );
      await unwrap(invited.auth.updateUser({ password }));
      await unwrap(invited.rpc("accept_platform_invites"));
      assert.equal(
        await unwrap(invited.rpc("can_manage", { t: tenant.id })),
        true,
      );
      await unwrap(invited.auth.signOut());
      await unwrap(
        invited.auth.signInWithPassword({ email: address, password }),
      );
      const recovery = await unwrap(
        service.auth.admin.generateLink({ type: "recovery", email: address }),
      );
      await unwrap(
        invited.auth.verifyOtp({
          type: "recovery",
          token_hash: recovery.properties.hashed_token,
        }),
      );
      await unwrap(invited.auth.updateUser({ password: password + "2" }));
      await unwrap(invited.auth.signOut());
      await unwrap(
        invited.auth.signInWithPassword({
          email: address,
          password: password + "2",
        }),
      );
      const event = Promise.withResolvers();
      const ready = Promise.withResolvers();
      channel = invited
        .channel("smoke-" + randomUUID())
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: "tenant_id=eq." + tenant.id,
          },
          (message) => event.resolve(message.new),
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") ready.resolve();
          if (["CHANNEL_ERROR", "TIMED_OUT"].includes(status))
            ready.reject(Error(status));
        });
      await ready.promise;
      const slug = "demonstracao-local";
      const catalog = await unwrap(
        service.rpc("booking_catalog", { p_slug: slug }),
      );
      const serviceId = catalog.services[0].id;
      const slots = await unwrap(
        service.rpc("booking_slots", {
          p_slug: slug,
          p_service: serviceId,
          p_day: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
        }),
      );
      assert.ok(slots.length, "O tenant de teste precisa de disponibilidade.");
      token = randomUUID();
      const booking = await unwrap(
        service.rpc("booking_create", {
          p_slug: slug,
          p_service: serviceId,
          p_professional: slots[0].professional_id,
          p_start: slots[0].starts_at,
          p_name: "Teste Realtime",
          p_phone: "11999901234",
          p_email: null,
          p_notes: null,
          p_key: randomUUID(),
          p_token: token,
        }),
      );
      const received = await Promise.race([
        event.promise,
        new Promise((_, reject) => {
          subscriptionTimeout = setTimeout(
            () => reject(Error("Nenhum evento Realtime em 15 segundos")),
            15000,
          );
        }),
      ]);
      assert.equal(received.appointment_id, booking);
    } finally {
      clearTimeout(subscriptionTimeout);
      if (channel) await invited.removeChannel(channel);
      if (token)
        await service.rpc("customer_update_booking", { p_token: token });
      if (userId) await service.auth.admin.deleteUser(userId);
      await operator.auth.signOut();
    }
  },
);
