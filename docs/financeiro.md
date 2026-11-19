# Financeiro e relatórios

Proprietários e administradores de empresas com o recurso financeiro habilitado acessam **Financeiro**. Selecione as datas dos atendimentos para registrar recebimento, desconto ou estorno. O diálogo aceita recebimentos parciais. Estornos têm como limite o valor líquido recebido. Cada operação conserva o seu lançamento original e gera uma entrada de auditoria. Para um atendimento sob consulta, o recebimento pode ser informado diretamente.

Em **Nova despesa**, informe categoria, valor e vencimento. Selecione **Despesa paga** para informar a data de pagamento e o meio utilizado. Para quitar um lançamento pendente, abra a aba **Despesas** e use **Dar baixa**.

Uma recorrência semanal, mensal ou anual cria entre 2 e 120 obrigações em uma transação. O valor informado é o valor de cada parcela. A primeira data determina todos os vencimentos. Uma série iniciada no dia 31 vence no último dia de meses mais curtos e volta a vencer no dia 31 quando possível. A opção de pagamento no cadastro quita apenas a primeira parcela.

## Interpretação

- **Receita recebida** soma os recebimentos e subtrai os estornos pela data do movimento.
- **Despesas pagas** usam a data efetiva da baixa. A diferença entre a receita recebida e as despesas pagas é o resultado de caixa.
- **Valor dos agendamentos** considera o preço registrado no momento da reserva, excluindo cancelamentos e faltas.
- **A receber no período** usa o saldo dos atendimentos do período na data final do filtro. Descontos e pagamentos reduzem esse saldo. Um estorno volta a aumentá-lo.
- **Despesas por vencimento** considera as obrigações que vencem no período selecionado. **Contas a pagar** mantém aquelas ainda em aberto na data final.
- **Receita líquida por atendimento concluído** usa o preço após descontos dos atendimentos concluídos no período. Para serviços sob consulta, usa o total recebido até a data final. **Resultado operacional** subtrai as despesas com vencimento no período dessa receita.
- **Comissões geradas** usa o preço registrado e o percentual do profissional quando o atendimento é concluído. A despesa do pagamento da comissão é lançada pelo gestor.
- Os limites de datas são inclusivos e usam o fuso da empresa no banco.

Em **Relatórios**, selecione o período e o agrupamento para consultar receitas por dia, mês, profissional ou serviço e despesas por categoria. **Exportar CSV** inclui recebimentos, estornos, descontos e despesas. **Imprimir / PDF** abre a impressão do navegador com os indicadores e a aba de movimentos selecionada.

## Verificação

No Node 24, rode `node --test tests/finance.test.mjs` para validar o cálculo e o escape do CSV. Com o mesmo PostgreSQL descartável e as dependências usadas por `tests/database.py`, rode `python tests/recurrence.py` para verificar vencimentos de fim de mês, reenvio idempotente, baixa individual e competência da parcela.
