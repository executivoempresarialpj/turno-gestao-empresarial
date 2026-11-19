# Turno • SaaS de agendamentos

## Instalação atual pelo navegador

Consulte [INSTALACAO.md](INSTALACAO.md) para publicar pelo GitHub, Vercel e Supabase sem instalar programas no computador. Sistema publicado: https://turno-six-rho.vercel.app/login.

A versão atual usa criação de empresas com usuário e senha, plano único de R$ 80 com cobrança manual, horários por data, serviços com preços e recebimentos avulsos. As instruções históricas abaixo sobre equipe, convites e Asaas não são necessárias para essa instalação; siga o guia atual.

Aplicação em português com Next.js App Router, React, TypeScript e PostgreSQL no Supabase. O cliente agenda em `/agendar/<slug>`, recebe um comprovante em `/reserva/<token>` e pode consultá-lo sem login. A equipe entra em `/login` e o operador da plataforma em `/superadmin`.

## Estrutura

- `app/(gestor)` contém painel, agenda, clientes, catálogo, equipe, finanças, relatórios e configurações.
- `app/superadmin` contém o painel comercial e as ações administrativas verificadas no servidor.
- `app/api` recebe eventos de cobrança e processa a fila de notificações.
- `components` e `lib` contêm os componentes de interface, cálculos e clientes do Supabase.
- `supabase/migrations` contém o esquema, permissões, RLS, procedimentos transacionais, índices e auditoria. Aplique todos os arquivos em ordem numérica.
- `tests` contém testes do banco, do navegador e dos serviços do Supabase.

## Instalação local

Use Node.js 22.12 ou superior, npm e um projeto Supabase de desenvolvimento. Para executar o Supabase no computador, instale a CLI e Docker. No diretório do projeto, execute os comandos abaixo.

```sh
npm ci
cp .env.example .env.local
supabase init
supabase start
supabase db reset
```

O reset recria o banco local e carrega o estabelecimento fictício de `supabase/seed.sql`. Use `supabase status` para obter as chaves e a URL locais. Configure `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` em `.env.local`; defina `APP_URL` como a origem do Next. Apenas URL e chave anônima do Supabase vão para o navegador. Execute `npm run dev` e acesse `http://localhost:3000/agendar/demonstracao-local`.

Como alternativa, conecte a CLI a um projeto Supabase de desenvolvimento e use `supabase db push`. Carregue o seed manualmente apenas se desejar o tenant fictício. Os painéis usam os lançamentos persistidos e os novos estabelecimentos começam vazios.

## Primeiro operador e empresa

1. Crie e confirme uma conta do proprietário da plataforma no Supabase Auth. Copie o UUID da conta.
2. Em uma sessão administrativa do SQL Editor, execute uma vez o comando abaixo, substituindo o marcador pelo UUID.
3. Acesse `/login` com a conta e, no superadministrador, configure o valor mensal do plano desejado. Em **Nova empresa**, preencha nome, slug, plano e e-mail do responsável.
4. Abra o convite do responsável, defina sua senha e acesse a empresa. Configure os horários da empresa, crie o profissional e o serviço e vincule os dois. Abra o link público em outro navegador e conclua uma reserva.
5. Para vincular um proprietário local já cadastrado a outro estabelecimento de demonstração, execute `psql "$LOCAL_DATABASE_URL" -v owner_email='responsavel@example.test' -f examples/local-demo.sql` uma vez.

```sql
insert into private.superadmins(user_id)
values ('UUID-DA-CONTA'::uuid)
on conflict do nothing;
```

## Auth e publicação na Vercel

Em Supabase Auth → URL Configuration, configure a Site URL com a origem HTTPS publicada e autorize o redirecionamento para `/acesso`. Configure o SMTP do Auth para entrega dos convites e recuperações. No template de convite use o endereço abaixo para o botão. No template de recuperação, troque `type=invite` por `type=recovery`. O servidor verifica o token antes de encaminhar a pessoa à definição da senha.

```text
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite
```

Crie um projeto Supabase de produção separado. Vincule a CLI com `supabase link --project-ref <ref>` e aplique `supabase db push` sem incluir o seed. Importe o repositório na Vercel com o preset Next.js e a pasta que contém `package.json` como raiz. Configure as variáveis de produção da mesma forma que no desenvolvimento, substituindo a URL local em `APP_URL`. Execute `npm run typecheck` e `npm run build`. Reimplante a aplicação quando alterar as variáveis públicas, incorporadas durante o build.

Confira no painel do Supabase se a publicação `supabase_realtime` inclui `appointments` e `notifications`. O tenant, o papel do membro, o estado da empresa e a validade da assinatura condicionam a leitura. A área da plataforma usa uma relação privada de superadministradores. Valores monetários são armazenados em centavos e os instantes da agenda, em `timestamptz`. A disponibilidade usa o fuso IANA do estabelecimento. Reservas, receitas da empresa e cobranças da assinatura têm registros distintos.

## Cobranças e mensagens

O guia de integração do Asaas está em [Cobrança mensal PIX](app/api/billing/asaas/README.md). Preencha as variáveis `ASAAS_API_KEY`, `ASAAS_ENVIRONMENT` e `ASAAS_WEBHOOK_TOKEN` no servidor. Registre o endpoint HTTPS `/api/billing/asaas` no gateway e configure o mesmo token de autenticação. Valide o ciclo de criação, recebimento e estorno no sandbox antes de habilitar cobranças reais.

Para confirmações por e-mail, configure uma identidade verificada no Resend e preencha `RESEND_API_KEY` e `RESEND_FROM`. Para WhatsApp, configure a conta empresarial Meta, o token, o ID do telefone, a versão suportada da Graph API e um template aprovado em pt_BR com quatro parâmetros de corpo na ordem empresa, serviço, profissional e data/hora. Configure um agendador para chamar `GET /api/notifications/dispatch` a cada minuto com `Authorization: Bearer <CRON_SECRET>`. A periodicidade disponível depende do plano de hospedagem. A fila registra a aceitação pelo provedor. Entrega ao destinatário exige confirmação do provedor. Mensagens com resultado incerto devem ser conciliadas antes de reenviar.

## Testes

```sh
npm test
npm run typecheck
npm run build
python -m venv .venv
. .venv/bin/activate
python -m pip install -r tests/requirements.txt
TEST_DATABASE_URL='postgresql://postgres@localhost/postgres' python tests/database.py
```

O teste de banco precisa de um **cluster descartável de desenvolvimento** com PostgreSQL 15 ou superior, extensão btree_gist e permissão para criar banco e papéis. Ele cria um banco aleatório, aplica todas as migrations, carrega o seed e remove o banco ao terminar. Cria os papéis convencionais de teste se estiverem ausentes. Representa o contrato mínimo de `auth.uid()` e do catálogo de usuários para testar SQL e RLS. Exercita concorrência com conexões independentes, remarcação, cancelamento, cadastro, isolamento, convite, auditoria financeira, suspensão e idempotência da cobrança.

Com Next.js em execução, Supabase configurado e o seed local instalado, o teste de navegador realiza uma reserva de teste, abre o comprovante e cancela em viewport móvel de 390 × 844.

```sh
python -m pip install playwright
python -m playwright install chromium
TEST_APP_URL=http://localhost:3000 python tests/mobile.py
```

Para validar GoTrue e Realtime, use um **projeto Supabase descartável** com as migrations, seed e um operador do SaaS. Carregue as variáveis do projeto, informe `TEST_OPERATOR_EMAIL` e `TEST_OPERATOR_PASSWORD` no ambiente e execute o teste abaixo. Ele gera um link de convite pelo Auth Admin, verifica o token, ativa o vínculo, autentica por senha, troca a senha por recuperação e verifica um evento real de reserva na assinatura WebSocket. Ele remove o usuário temporário e cancela a reserva. A entrada cancelada continua no histórico. O teste usa links gerados pelo provedor, sem exercitar o transporte SMTP.

```sh
TEST_SUPABASE_SMOKE=disposable node --env-file=.env.local --test tests/hosted.test.mjs
```

Antes da ativação comercial, valide as credenciais e a entrega de mensagens no seu domínio, as URLs de redirecionamento do Auth, a cobrança na conta Asaas, as rotinas de backup/restauração e a política de retenção dos dados de clientes.

## Operações de suporte e exclusão

Em **Superadmin → Configuração global**, o operador define os dias de retenção de novas solicitações. O valor inicial é 90 dias e deve ser ajustado conforme o contrato e a legislação aplicável. Na empresa, confirme o slug para bloqueá-la e iniciar o prazo. Depois do vencimento, a exclusão definitiva exige nova confirmação. O sistema preserva o histórico agregado de cobranças da plataforma e a auditoria. Dados identificáveis em backups, no gateway e nos provedores de entrega seguem os procedimentos de cada operador. Encerrar sessões revoga o acesso das sessões existentes àquela empresa. Uma nova autenticação permanece disponível enquanto o vínculo estiver ativo.

O hook de erros do Next.js registra o modelo da rota e o identificador de erro no log da hospedagem. Configure alertas e retenção dos logs no ambiente de produção. Referências técnicas: [banco e indicadores](docs/banco-e-indicadores.md), [API pública](docs/api-publica.md), [financeiro](docs/financeiro.md) e [notificações](docs/notificacoes.md).

Com `TEST_DATABASE_URL` exportada no ambiente de testes, execute também `python tests/billing.py`, `python tests/delivery.py`, `python tests/recurrence.py` e `python tests/retention.py`. As suítes criam bancos descartáveis e cobrem o ciclo da assinatura, a fila de entrega, as despesas recorrentes, a revogação de acesso e a exclusão com prazo.

O teste adicional `python tests/resources.py` disputa uma sala entre dois profissionais e verifica que o dono de outra empresa não consegue consultar a reserva, editar a sala ou excluí-la. As verificações executadas para esta entrega constam em [Validação](docs/validacao.md).

## Publicação da homologação

A publicação hospedada na Vercel usa a integração Supabase do Marketplace. O build em produção usa POSTGRES_URL_NON_POOLING para aplicar apenas migrações pendentes, em transações com bloqueio concorrente, por conexão TLS validada pelas autoridades de certificação do Supabase. As variáveis do banco devem chegar pela integração. O endereço da aplicação pode ser definido em APP_URL ou obtido de VERCEL_PROJECT_PRODUCTION_URL. O seed local permanece fora da publicação. No plano Hobby, a implantação não agenda o disparo externo por minuto. As notificações internas continuam disponíveis. Para uso comercial, configure um plano de hospedagem adequado e os provedores de cobrança e comunicação desejados.

Para ativar o acesso com o modelo de e-mail padrão do Supabase, copie o endereço do botão de convite e cole-o em /acesso. O navegador valida o token diretamente com o provedor. Configure também a Site URL e os redirecionamentos do Supabase Auth para o domínio publicado para habilitar o acesso direto pelo botão.
