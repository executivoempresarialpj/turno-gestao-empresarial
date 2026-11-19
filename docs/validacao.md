# Validação da entrega

| Verificação executada | Ambiente e resultado |
|---|---|
| Compilação e verificação estática | Next.js 15, React 19 e TypeScript. Build de produção executado. |
| Fluxo público no celular | Chromium em 390 × 844, aplicação Next.js, endpoint HTTP de reservas, PostgREST e PostgreSQL locais. Reserva sem login, comprovante e cancelamento passaram. |
| Banco, disponibilidade e separação de empresas | PostgreSQL 18.6, migrações aplicadas em bancos descartáveis. Os testes cobriram a disputa por profissional e sala, idempotência, remarcação, liberação de horários, bloqueio, suspensão e operações entre empresas. |
| Financeiro | Testes em PostgreSQL para pagamentos, despesas, recorrências, caixa e indicadores conforme a cobertura dos arquivos de teste. Testes Node para caixa, competência e exportação CSV. |
| Plataforma | Provisionamento, ativação de vínculo, autorização administrativa, eventos de cobrança repetidos, estorno, cancelamento, revogação por empresa e retenção verificados no banco. |
| Confirmações | Consentimento, retirada exclusiva da fila, repetição após limitação de requisições e registro do resultado verificados no PostgreSQL. |

Os testes de banco usam um contrato mínimo do Supabase Auth. O teste hospedado de convite, login, recuperação e entrega de evento via WebSocket está disponível em `tests/hosted.test.mjs` e requer um projeto Supabase descartável com credenciais reais. A execução desta entrega não incluiu essa homologação, entrega em caixa de e-mail ou WhatsApp, cobrança externa efetiva nem publicação na conta Vercel.

A versão usa bloqueios de agenda para férias, feriados e indisponibilidades manuais. O PDF é gerado pela impressão do navegador e a exportação para planilhas usa CSV. A fila externa envia confirmações iniciais. Lembretes programados, múltiplas unidades, fidelidade e integração com Google Calendar ficam para versões seguintes.
