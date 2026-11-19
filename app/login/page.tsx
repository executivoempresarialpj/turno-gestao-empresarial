"use client";
import { useState, type FormEvent } from "react";
import { db } from "@/lib/db";
import { Activity, CalendarDays, ArrowRight, ShieldCheck } from "lucide-react";
import "./auth.css";
export default function Login() {
  const [recover, setRecover] = useState(false),
    [busy, setBusy] = useState(false),
    [msg, setMsg] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setMsg("");
    try {
      const client = db();
      const login = String(f.get("email")).trim().toLowerCase();
      const email=login.includes("@")?login:login+"@login.turno.invalid";
      if (recover) {
        const { error } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: location.origin + "/acesso",
        });
        if (error) throw error;
        setMsg(
          "Se houver uma conta para este e-mail, você receberá as instruções de recuperação.",
        );
        return;
      }
      const { error } = await client.auth.signInWithPassword({
        email,
        password: String(f.get("password")),
      });
      if (error) {
        setMsg("Não foi possível entrar. Verifique seu e-mail e senha.");
        return;
      }
      const { data, error: authz } = await client.rpc("is_superadmin");
      if (authz) throw authz;
      location.assign(data ? "/superadmin" : "/");
    } catch {
      setMsg("Falha ao acessar o serviço. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="access-shell">
      <aside className="login-art">
        <div className="login-brand">
          <span>
            <img src="/turno-icon.png" alt="" width={39} height={39} />
          </span>
          Turno
        </div>
        <div className="art-title">
          <span>GESTÃO DE AGENDAMENTOS</span>
          <h2>
            Seu espaço
            <br />
            de gestão.
          </h2>
        </div>
        <div className="calendar-art" aria-hidden="true">
          <div className="art-strip">
            <CalendarDays />
            <i />
            <i />
            <i />
          </div>
          <div className="art-grid">
            {Array.from({ length: 28 }, (_, i) => (
              <i key={i} className={"date-cell c" + i}>
                {i + 1}
              </i>
            ))}
          </div>
        </div>
        <div className="art-footer">
          <ShieldCheck size={16} /> Área do estabelecimento
        </div>
      </aside>
      <section className="access-card">
        <div className="login-brand compact">
          <span>
            <img src="/turno-icon.png" alt="" width={39} height={39} />
          </span>
          Turno
        </div>
        <div className="auth-eyebrow">WORKSPACE</div>
        <h1>{recover ? "Recuperar acesso" : "Acesse sua conta"}</h1>
        <p>
          {recover
            ? "Receba as instruções por e-mail."
            : "Entre para acompanhar sua agenda, seus clientes e seu financeiro."}
        </p>
        {!process.env.NEXT_PUBLIC_SUPABASE_URL && (
          <p role="status" className="setup-note">
            Ambiente em configuração. O acesso será liberado após conectar o
            Supabase.
          </p>
        )}
        <form onSubmit={submit}>
          <label>
            Usuário ou e-mail
            <input type="text" name="email" autoComplete="email" required />
          </label>
          {!recover && (
            <label>
              Senha
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
          )}
          <button disabled={busy || !process.env.NEXT_PUBLIC_SUPABASE_URL}>
            {busy ? "Aguarde…" : recover ? "Enviar instruções" : "Entrar"}{" "}
            <ArrowRight size={16} />
          </button>
        </form>
        <button
          className="secondary"
          onClick={() => {
            setRecover(!recover);
            setMsg("");
          }}
        >
          {recover ? "Voltar ao login" : "Esqueci minha senha"}
        </button>
        <p role="status">{msg}</p>
      </section>
    </main>
  );
}
