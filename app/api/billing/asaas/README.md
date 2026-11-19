# Assinaturas mensais Asaas

No painel Asaas, crie uma chave de API e configure um webhook JSON v3 para `https://SEU-DOMINIO/api/billing/asaas`. Marque PAYMENT_RECEIVED, PAYMENT_OVERDUE e PAYMENT_REFUNDED. Defina um token de autenticação forte no webhook e armazene seu valor em ASAAS_WEBHOOK_TOKEN. A validação usa o cabeçalho asaas-access-token.

Use ASAAS_API_KEY correspondente ao ambiente. ASAAS_ENVIRONMENT=sandbox seleciona o ambiente de testes. A produção exige ASAAS_ENVIRONMENT=production e credenciais da conta comercial. Cadastre o webhook separadamente em cada ambiente.

1. Em Superadmin, configure o preço mensal do plano e cadastre uma empresa.
2. Na empresa, insira a identificação fiscal do pagador, o e-mail financeiro e o primeiro vencimento, após obter sua autorização. A aplicação transmite CPF/CNPJ diretamente ao Asaas pelo servidor. Não os grava no banco da plataforma.
3. Emita a assinatura mensal por PIX e abra a fatura. O pagador realiza um pagamento a cada período. A criação da cobrança mantém o estado de acesso vigente.
4. Confira o recebimento no painel comercial após a entrega do webhook. A receita utiliza o valor bruto recebido, líquido de estornos integrais registrados. Tarifas do provedor e estornos parciais exigem conciliação separada.
5. Para interromper a recorrência e encerrar o acesso, use “Cancelar cobrança e encerrar acesso”. Alterações de plano/preço no cadastro local exigem conciliação do contrato vigente no gateway. A suspensão do acesso ao aplicativo preserva o contrato no gateway.

A tabela privada billing_provisioning reserva a operação antes de acessar o provedor. Se o resultado for incerto, localize a cobrança no Asaas pela referência externa exibida. Vincule o identificador real na empresa. Se o provedor confirmar que a cobrança não existe, um operador autorizado pode remover a linha da tabela privada correspondente à tentativa após a conciliação.

O processamento aceita reentregas por ID de evento e por ID de pagamento. O encerramento automático da inadimplência exige recebimento efetivo de fatura vinculada. Cobranças de clientes finais dos estabelecimentos ficam fora deste fluxo.
