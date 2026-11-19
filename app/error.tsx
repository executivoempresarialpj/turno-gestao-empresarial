"use client";
export default function ErrorScreen({ reset }: { reset: () => void }) {
  return (
    <section className="setup" role="alert">
      <h1>Falha ao abrir esta página</h1>
      <p>Confira sua conexão e tente carregar os dados novamente.</p>
      <button onClick={reset}>Tentar novamente</button>
    </section>
  );
}
