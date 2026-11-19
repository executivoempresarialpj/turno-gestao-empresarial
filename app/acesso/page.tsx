"use client";
import { useEffect, useState, type FormEvent } from "react";
import { db } from "@/lib/db";
import "../login/auth.css";
export default function Access() {
  const [ready, setReady] = useState(false),
    [msg, setMsg] = useState("Verificando o link…"),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    async function open() {
      try {
        if (new URLSearchParams(location.search).has("expirado")) throw Error();
        const fragment = new URLSearchParams(location.hash.slice(1));
        const access_token=fragment.get("access_token"), refresh_token=fragment.get("refresh_token");
        if(access_token && refresh_token){
          history.replaceState(null,"",location.pathname);
          const session=await db().auth.setSession({access_token,refresh_token});
          if(session.error)throw session.error;
        }
        const { data, error } = await db().auth.getUser();
        if (error || !data.user) throw Error();
        setReady(true);
        setMsg("");
      } catch {
        setMsg("Copie o endereço do botão recebido por e-mail e cole abaixo para ativar seu acesso.");
      }
    }
    void open();
  }, []);
  async function verifyEmailLink(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form=e.currentTarget;
    setBusy(true);
    try{
      const link=new URL(String(new FormData(form).get("convite")));
      const type=link.searchParams.get("type");
      if(link.origin!==new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin || link.pathname!=="/auth/v1/verify" || (type!=="invite" && type!=="recovery"))throw Error();
      const token=link.searchParams.get("token")||link.searchParams.get("token_hash");
      if(!token)throw Error();
      const verification=await db().auth.verifyOtp({token_hash:token,type});
      if(verification.error)throw verification.error;
      form.reset();setReady(true);setMsg("");
    }catch{setMsg("Confira se copiou o endereço original do botão do e-mail. Links expirados ou utilizados precisam ser renovados.")}
    finally{setBusy(false)}
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("senha") !== f.get("confirmar")) {
      setMsg("As senhas precisam coincidir.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await db().auth.updateUser({
        password: String(f.get("senha")),
      });
      if (error) throw error;
      const { error: inviteError } = await db().rpc("accept_platform_invites");
      if (inviteError) throw inviteError;
      const admin=await db().rpc("is_superadmin");
      location.assign(admin.data ? "/superadmin" : "/");
    } catch {
      setMsg(
        "Não foi possível finalizar o acesso. Confira as regras da senha e tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="access-shell">
      <section className="access-card">
        <h1>Configurar senha</h1>
        {!ready && <form onSubmit={verifyEmailLink}><label>Link de convite ou recuperação<input type="url" name="convite" required autoComplete="off" spellCheck={false}/></label><button disabled={busy}>Validar link do e-mail</button></form>}
        {ready && (
          <form onSubmit={save}>
            <label>
              Nova senha (mínimo de 12 caracteres)
              <input
                type="password"
                name="senha"
                minLength={12}
                autoComplete="new-password"
                required
              />
            </label>
            <label>
              Confirmar senha
              <input
                type="password"
                name="confirmar"
                minLength={12}
                autoComplete="new-password"
                required
              />
            </label>
            <button disabled={busy}>Salvar e entrar</button>
          </form>
        )}
        <p role="status">{msg}</p>
        <a href="/login">Voltar ao login</a>
      </section>
    </main>
  );
}
