# Instalação do Turno pelo navegador

## Sistema já publicado
Abra https://turno-six-rho.vercel.app/login. O proprietário administra empresas em /superadmin. Crie uma empresa no plano Turno de R$ 80 e defina usuário e senha.

Entre com o usuário da empresa. Em Configurações, escolha a data e adicione as horas. Cadastre os serviços e os preços. Envie logo e foto de capa em JPG, PNG ou WebP de até 5 MB e escolha a cor principal. Abra o link público e faça uma reserva.

A confirmação registra a reserva e abre o WhatsApp com a mensagem pronta. O cliente confirma o envio dentro do WhatsApp. O comprovante fica disponível ao voltar no navegador. O destino desta instalação é (79) 99900-9358.

No Financeiro, use Registrar recebimento para reservas ou Registrar recebimento avulso para clientes externos. Valores avulsos entram no caixa e serviços agendados alimentam a receita prevista.

## Nova publicação pelo GitHub e Vercel
1. Abra Vercel → Add New → Project → Import Git Repository.
2. Escolha o repositório Turno. A raiz deve conter package.json. Use Next.js e Node.js 24.
3. Crie ou conecte um banco Supabase pela integração Storage/Marketplace da Vercel.
4. Em Environment Variables de produção, confira NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY e POSTGRES_URL_NON_POOLING. A integração fornece os valores. Guarde a chave service_role e a senha do banco somente nas variáveis privadas.
5. Defina APP_URL com o endereço público HTTPS, sem barra final.
6. Clique Deploy. O comando npm run vercel-build aplica as migrações pendentes e compila o site. O seed local fica fora da publicação.
7. No Supabase → Authentication → URL Configuration, configure Site URL como APP_URL e autorize APP_URL/acesso em Redirect URLs.
8. Para a primeira conta de proprietário, crie uma conta confirmada em Authentication → Users. Copie o UUID. No SQL Editor, execute a instrução abaixo, substituindo o marcador.

    insert into private.superadmins(user_id) values ('UUID-DO-USUARIO'::uuid) on conflict do nothing;

9. Entre no sistema com essa conta. Os próximos usuários são criados pelo painel, com usuário e senha.

## Tela inicial do iPhone
Abra o login no Safari, toque em Compartilhar → Adicionar à Tela de Início. O nome Turno e seu ícone aparecem no atalho. Se houver um atalho antigo, remova-o e adicione novamente.

## Testes e manutenção
Para desenvolvimento, use Node.js 24 e execute npm ci, npm run typecheck e npm run build. Copie .env.example para .env.local e preencha com um Supabase de desenvolvimento.

O arquivo tests/simple_booking.py testa data específica, serviço e preço, comprovante, recebimento externo e dashboard. Configure TEST_DATABASE_URL para um PostgreSQL descartável com permissão de criação de bancos. Instale tests/requirements.txt e execute python tests/simple_booking.py.

O controle da mensalidade é manual. Escolha um plano de hospedagem compatível com o uso comercial conforme as regras do provedor.
