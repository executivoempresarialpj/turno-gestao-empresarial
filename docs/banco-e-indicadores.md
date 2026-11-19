# Banco e indicadores

A identidade de acesso vem de `auth.users` e do JWT que o Supabase verifica. O mesmo usuário pode participar de mais de uma empresa. A tabela `tenant_memberships` vincula a identidade ao estabelecimento, à função e ao estado do acesso. Todas as tabelas operacionais carregam `tenant_id`. Chaves compostas exigem que o serviço, o profissional e o cliente referenciados pertençam à mesma empresa.

## Permissões

| Operação | Autorização no banco |
| --- | --- |
| Consultar e operar a agenda | Membro ativo da empresa com assinatura vigente |
| Alterar serviços, profissionais, horários e identidade visual | Proprietário ou administrador do estabelecimento |
| Consultar o financeiro e registrar pagamentos e despesas | Proprietário ou administrador de empresa com o recurso `finance` habilitado no plano |
| Administrar empresas, planos, convites e assinaturas | Usuário presente em `private.superadmins` |
| Reservar como consumidor | Fluxo público restrito ao catálogo, disponibilidade e confirmação |
| Consultar ou alterar uma reserva como consumidor | Token individual de posse do consumidor |

`tenant_available` verifica simultaneamente o estado da empresa, o estado da assinatura e seu vencimento. A suspensão passa a valer na consulta seguinte ao banco, inclusive para usuários com sessão válida. O super administrador consulta entidades comerciais e registros de auditoria. As políticas das tabelas de atendimento exigem uma associação explícita ao estabelecimento.

## Primeira identidade da plataforma

Crie um usuário com e-mail confirmado pelo painel Authentication do Supabase e copie seu UUID. No SQL Editor do projeto, execute uma vez, substituindo o identificador entre aspas.

```sql
insert into private.superadmins(user_id)
select id from auth.users
where id = 'UUID-DO-PROPRIETARIO'::uuid
  and email_confirmed_at is not null
returning user_id;
```

Confira o UUID devolvido e faça login em `/login`. O painel `/superadmin` permite criar o próximo estabelecimento e convidar seu responsável. Restrinja a lista de projetos e administradores com acesso ao SQL Editor, às credenciais administrativas e aos backups.

## Leitura dos indicadores

- A receita recebida soma pagamentos pela data do recebimento e deduz estornos na data em que são registrados. Uma reserva nova aumenta apenas a previsão. Um pagamento parcial aumenta o caixa pelo valor pago.
- O ticket médio do período divide o caixa líquido pelo número de atendimentos distintos que receberam ao menos um pagamento naquele intervalo. Quando o denominador é zero, o painel usa um traço.
- A taxa de cancelamento divide o número de reservas canceladas pelo total de reservas com início previsto no período.
- A ocupação divide os minutos reservados, incluindo preparação, pelos minutos disponíveis dos profissionais ativos. A capacidade usa a interseção dos horários da empresa com os individuais, deduz bloqueios e consolida intervalos sobrepostos. O cálculo histórico utiliza as escalas e o estado dos profissionais configurados no momento da consulta.
- A comparação usa o período imediatamente anterior, com igual número de dias. O gráfico mensal cobre de janeiro até a data final selecionada. Os dias, as semanas e os meses são delimitados pelo fuso IANA configurado pela empresa.
- Os valores monetários persistidos estão em centavos de reais. Horários de reservas e eventos estão em `timestamptz`. A tabela financeira de assinaturas da plataforma é independente da tabela de pagamentos dos atendimentos.

## Dados de demonstração

O seed de desenvolvimento em `supabase/seed.sql` prepara a empresa `demonstracao-local`. Para um ambiente local separado, o script opcional `examples/local-demo.sql` cria uma empresa de demonstração com membro proprietário, expediente com almoço e serviço de consultoria. Ele requer um usuário de teste previamente criado pelo Auth.

```bash
psql "$LOCAL_DATABASE_URL" -v owner_email='teste@example.test' -f examples/local-demo.sql
```

Entre com a conta de teste e abra `/agendar/demo-estudio-horizonte` em outra janela para realizar a primeira reserva. Os scripts de demonstração devem ser usados somente em projetos de desenvolvimento.
