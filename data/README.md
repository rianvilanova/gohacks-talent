# Bases CSV dos 3 desafios: GoHacks Talent 2026

Bases de dados dos desafios do `Desafios_GoHacks_Talent_2026.pdf`: **Atendimento ao Cliente**, **Pagamentos** e **Transportes**. Cada pasta reproduz a exportação dos sistemas de uma área de e-commerce, com cadastros, transações e logs. As tabelas se ligam por ID, como num banco de dados de verdade.

**São 85 CSVs:**

| Desafio | Arquivos | Tamanho |
| --- | ---: | ---: |
| Atendimento | 24 | 11 MB |
| Pagamentos | 24 | 11 MB |
| Transportes | 37 | 37 MB |

Os dados são sintéticos e mostram a empresa em **02/11/2026 às 08h**, o início da semana do evento. Datas posteriores aparecem só em previsões, vencimentos, vigências e na agenda de pagamentos. Cada pasta tem também:

- `dicionario_de_dados.md`: o significado de cada coluna;
- `parametros.md`: custos em R$ e premissas.

**Como ler este documento:**

1. **Ponto do PDF → dados.** Cada linha é um ponto de "Alguns dos desafios" do PDF. A tabela mostra a pergunta que o agente precisa responder, os dados necessários e os arquivos onde estão.
2. **Catálogo.** As tabelas agrupadas pelo sistema de origem, com o número de linhas.

---

## 1. Atendimento ao Cliente (`atendimento/`)

O ponto de partida é a **compra**: 6,1 mil pedidos de 2,9 mil clientes nas lojas Gocase e GoBeauté, com itens, pagamento, cupom, produção, entrega e pós-venda. Sobre essas compras chegaram 3 mil conversas em 90 dias, por WhatsApp, e-mail e Reclame Aqui.

**Catálogo da Gocase:** são os produtos reais, com nomes e preços próximos do ticket médio real (fonte: GoIntelligence Gocase, nov/2026). São 71 SKUs, contando as versões personalizadas e as cores:

| Linha | Produtos |
| --- | --- |
| Cases | Case Anti Impacto Slim Air, Slim Standard, Infinite Air e Guard Magsafe, para iPhone, Samsung e Motorola |
| Copos | Vibe 470 ml, Life 1100 ml e Daily 600 ml |
| Garrafas | Fresh 650 e 950 ml, Urban 500 ml e Mini 350 ml |
| Acessórios | Connect Card Magsafe |
| Necessaires | Makeup Double e Voyage |
| Bolsas e malas | Tote Bag Daily, Mini Tote, Bolsa Moove e Mala Trip 20" |

Clientes, pedidos, valores e conversas são fictícios. As marcas GoBeauté seguem com catálogo fictício.

### Ponto do PDF → dados

| Ponto do PDF | O que o agente precisa responder | Onde está |
| --- | --- | --- |
| **O volume e o tempo que cada contato consome** | Quantos contatos chegam por canal e assunto, quanto tempo de gente cada um consome, qual é a satisfação e quanto custa | `historico_conversas` (canal, tag, atendente, primeira resposta, encerramento, CSAT); `historico_mensagens`; `tempo_por_conversa` (minutos trabalhados, sistemas acessados); `avaliacoes_csat`; `reclame_aqui`; `politicas` (custo por canal e SLA) |
| **O trabalho espalhado entre sistemas e portais diferentes** | Por quais sistemas um contato passa e o que cada um sabe | `pedidos` e `itens_pedido` (ERP); `rastreio_portais_transportadoras` (portais); `pagamentos_gateway` e `estornos` (gateway); `trocas_reenvios` (sistema de trocas e reenvios); `cupons` e `uso_cupons`; `chamados_transportadora`; `acoes_executadas_sistemas` (log de tudo o que o time fez, com o ID do registro em cada sistema) |
| **Saber se a reclamação é verdadeira antes de agir** | A foto é deste pedido e deste produto? Foi tirada depois da entrega? O produto e a personalização batem com o pedido? O cliente tem histórico de reenvios? | `anexos_conversas` (metadados da foto e descrição do que ela mostra); `itens_pedido` (produto e texto da personalização); `produtos`; `pedidos` (data de entrega); `clientes`; `trocas_reenvios` (reenvios anteriores do cliente) |
| **Decidir o que se resolve sozinho e o que precisa de uma pessoa** | A ação está dentro da política e do limite em R$? É caso sensível? Quem aprova? | `politicas` (regras por categoria, limites por papel, reclamação suspeita); `ferramentas` (o que cada papel pode fazer); `equipe_atendimento` (atendentes, supervisores e analistas); `produtos` (composição e advertências, para dúvidas e reação adversa); `trocas_reenvios` e `estornos` (casos que precisaram de aprovação) |
| **Contatos que se repetem e poderiam ter sido evitados** | Quem voltou a escrever sobre o mesmo pedido, e o que esses pedidos têm em comum | `historico_conversas` (cliente e pedido); `pedidos` (transportadora, UF, CD, máquina, lote); `maquinas_personalizacao`; `lotes_producao`; `rastreio_portais_transportadoras`; `chamados_transportadora`; `pagamentos_gateway` (cobranças em dobro) |
| *(a fila de hoje)* | O que precisa ser tratado agora | `fila_aberta` |

### Catálogo

| Etapa da compra | Sistema | Arquivo | Linhas | O que é |
| --- | --- | --- | ---: | --- |
| Loja | Catálogo | `produtos` | 141 | Produtos Gocase (reais) e GoBeauté: preço, custo, peso, medidas, composição, modo de uso, advertências |
| | CRM | `clientes` | 2.867 | Cadastro com contato, CPF, cidade, segmento, consentimentos e histórico de compras |
| | ERP | `pedidos` | 6.092 | A compra: pagamento, cupom, frete, prazo prometido, rastreio, NF e endereço |
| | | `itens_pedido` | 6.413 | Itens comprados, inclusive o brinde e o texto da personalização |
| | Plataforma de cupons | `cupons` / `uso_cupons` | 18 / 3.812 | Regras dos cupons e cada aplicação ou recusa |
| Pagamento | Gateway | `pagamentos_gateway` | 6.046 | Tentativas de cobrança: método, status, NSU, autorização, valor estornado |
| | | `estornos` | 185 | Estornos pedidos e o resultado |
| Produção | Fábrica Gocase e qualidade GoBeauté | `maquinas_personalizacao` / `lotes_producao` | 6 / 584 | Impressoras da personalização e lotes com fabricação, validade e laudo |
| Entrega | Portais das transportadoras | `rastreio_portais_transportadoras` | 26.517 | Eventos de rastreio de cada pedido |
| | | `chamados_transportadora` | 375 | Chamados abertos, com resposta e nova previsão |
| Atendimento | Central de atendimento (WhatsApp, e-mail) | `historico_conversas` | 2.984 | Conversas dos últimos 90 dias: canal, tag, status, atendente, datas, assunto, CSAT |
| | | `historico_mensagens` | 13.731 | Mensagens de cliente, bot e atendente |
| | | `fila_aberta` | 65 | Conversas abertas agora |
| | | `anexos_conversas` | 382 | Fotos e prints enviados, com metadados e descrição |
| | | `tempo_por_conversa` | 2.654 | Tempo até a primeira resposta e minutos trabalhados |
| | | `avaliacoes_csat` | 1.975 | Pesquisas de satisfação enviadas e respondidas |
| | | `equipe_atendimento` | 27 | 21 atendentes, 3 supervisores e 3 analistas |
| | Reclame Aqui | `reclame_aqui` | 370 | Reclamações públicas: status, réplica, nota e "voltaria a fazer negócio" |
| Pós-venda | Trocas e reenvios | `trocas_reenvios` | 667 | Reenvios, trocas e novas produções: custo, aprovação, envio e entrega |
| | Log | `acoes_executadas_sistemas` | 4.856 | Cada ação do time, em qual sistema, com valor, executor e aprovador |
| Regras | Manual e permissões | `politicas` / `ferramentas` | 154 / 35 | Manual de atendimento e o que o agente pode fazer por papel |
---

## 2. Pagamentos (`pagamentos/`)

Contas a pagar para 131 fornecedores: 7 mil títulos desde abril e cerca de 100 por dia útil. Cada sistema exporta o próprio arquivo, e os dois bancos usam formatos diferentes.

### Ponto do PDF → dados

| Ponto do PDF | O que o agente precisa responder | Onde está |
| --- | --- | --- |
| **Um volume que não permite revisar pagamento por pagamento** | Quais títulos olhar primeiro, por valor, risco e horário do lote | `contas_a_pagar`; `agenda_remessa`; `lotes_remessa` (lotes que fecham hoje e o valor de cada um) |
| **Processos de cadastro extremamente manuais, repetidos em mais de um sistema** | O fornecedor está igual no ERP, em Compras, na NF e no banco? Quem alterou os dados bancários, quando e com qual confirmação? | `fornecedores` (ERP); `pedidos_compra` (Compras); `notas_fiscais` (emitente); `dda_boletos` (beneficiário registrado no banco); `alteracoes_cadastro`; `log_auditoria_erp`; `usuarios_sistema` |
| **Erros que nascem no cadastro manual: duplicidade, valores errados** | Este título já foi lançado? O valor bate com OC, NF, duplicata, boleto registrado e recebimento? Quem lançou e desde quando está na empresa? | `contas_a_pagar` (número da NF digitado, valor, quem lançou); `notas_fiscais` e `nf_duplicatas`; `pedidos_compra`; `recebimentos_mercadoria`; `dda_boletos`; `contratos_fornecedores`; `usuarios_sistema` (admissão) |
| **Informação fragmentada entre sistemas internos e bancos** | O que saiu de fato de cada banco? Algo já foi pago por outro caminho? | `extrato_banco_meridiano` (separador `,`); `extrato_banco_litoral` (separador `;`, dd/mm, vírgula decimal); `retorno_remessa` (pago ou rejeitado); `dda_boletos` (situação do boleto); `contas_bancarias_empresa`; `comunicacoes_fornecedores` (e-mails e WhatsApps) |
| **Pegar o erro antes de o dinheiro sair, e não depois** | O que está no próximo lote, quanto tempo falta para fechar e qual é o destino de cada pagamento | `agenda_remessa` (horário de fechamento, destino); `lotes_remessa`; `feriados_bancarios`; `politicas` (seção remessa) |
| **Saber o que pode seguir sozinho e o que precisa de aprovação** | O valor cabe na alçada? O caso exige dupla aprovação? Quem pode aprovar? | `politicas` (alçadas, dupla aprovação, segregação, fracionamento); `usuarios_sistema` (perfil e alçada); `aprovacoes` (como foi aprovado no passado); `ferramentas` |

### Catálogo

| Sistema | Arquivo | Linhas | O que é |
| --- | --- | ---: | --- |
| ERP | `fornecedores` | 131 | Cadastro com dados bancários, pix, contato, prazo, contrato e status |
| | `alteracoes_cadastro` | 68 | Alterações de cadastro: o que mudou, quem mudou e se houve confirmação |
| | `contas_a_pagar` | 7.120 | Títulos lançados à mão: NF, OC, valor, vencimento, centro de custo, aprovação, baixa |
| | `agenda_remessa` | 876 | Títulos agendados nos próximos lotes |
| | `aprovacoes` | 2.760 | Aprovações e reprovações já registradas |
| | `log_auditoria_erp` | 15.131 | Inclusões, alterações, aprovações, baixas e remessas, por usuário e estação |
| | `usuarios_sistema` | 31 | Usuários do ERP, de Compras e do WMS: cargo, perfil, alçada, admissão |
| | `centros_custo` / `plano_contas` | 14 / 36 | Estrutura contábil |
| Compras | `pedidos_compra` | 6.055 | OCs: quantidade, valor, condição, solicitante, aprovação |
| | `contratos_fornecedores` | 50 | Contratos recorrentes: valor mensal, vigência, reajuste |
| Recebimento (CD) | `recebimentos_mercadoria` | 3.088 | Entrada física da mercadoria (terceira via da conferência OC × NF × recebimento) |
| Portal de NF-e | `notas_fiscais` / `nf_duplicatas` | 4.151 / 7.895 | NFs recebidas, com impostos e manifestação, e as parcelas de cada uma |
| DDA (boletos registrados) | `dda_boletos` | 3.722 | Boletos emitidos contra o CNPJ da empresa, como o banco do fornecedor registrou |
| Bancos | `extrato_banco_meridiano` / `extrato_banco_litoral` | 4.496 / 437 | Extratos em formatos diferentes |
| | `lotes_remessa` / `retorno_remessa` | 127 / 4.566 | Arquivos de pagamento enviados e o retorno de cada título |
| | `contas_bancarias_empresa` | 2 | Contas, saldos, limites e horário de corte |
| | `feriados_bancarios` | 22 | Dias sem compensação |
| E-mail e WhatsApp | `comunicacoes_fornecedores` | 246 | Cobranças, boletos, pedidos de troca de conta, avisos de reajuste |
| Regras | `politicas` / `ferramentas` | 100 / 27 | Política de pagamentos e o que o agente pode fazer por papel |

---

## 3. Transportes (`transportes/`)

40 mil envios em 90 dias por 5 transportadoras. A data de entrega **não** está no ERP: ela só aparece nos portais, e cada portal tem o próprio formato.

### Ponto do PDF → dados

| Ponto do PDF | O que o agente precisa responder | Onde está |
| --- | --- | --- |
| **Escolher a melhor transportadora para cada envio** | Para este CEP, peso e volume: quem atende, em quanto tempo, a que custo e com que histórico na região | `envios`, `envios_expedicao` e `itens_envio`; `produtos` e `embalagens` (peso e cubagem); `cotacoes_frete` (o que o motor cotou de cada transportadora); `transportadoras_cobertura_sla`; `tabela_frete_*` (5 tabelas, cada uma num formato); `regras_site_roteamento_padrao`; os portais, para o desempenho |
| **Definir o prazo do site: competitivo para converter, realista para cumprir** | Qual prazo mostrar em cada região? Quanto se perde de conversão com um dia a mais e quanto se quebra de SLA com um dia a menos? | `regras_site_prazo_frete_por_prefixo` (SLA, margem de segurança, prazo exibido); `historico_regras_site` (como o prazo mudou e o que aconteceu); `checkout_conversao`; `envios` (data prometida); `cds` (horário de corte); `feriados` |
| **Medir a performance de cada transportadora por cabeça de CEP** | Qual porcentagem chega até a data prometida, por transportadora e prefixo de CEP | `envios` (código de rastreio, CEP, data prometida); `portal_*` (5 portais); `portal_vialog_codigos` (de-para dos status); `ocorrencias_entrega` (tentativas sem sucesso, extravios, avarias, devoluções); `chamados_transportadoras`; `cabecas_cep`; `politicas` (meta de cumprimento) |
| **Entender o posicionamento: o prazo está melhor, igual ou muito pior que o dos concorrentes?** | Por região, nosso prazo e frete contra os dos concorrentes, considerando se o produto deles está em estoque | `concorrentes_prazos`; `concorrentes` (quem é monitorado e como); `regras_site_prazo_frete_por_prefixo` |
| **Definir o melhor preço de frete para cada região** | Quanto custa de verdade entregar em cada região e quanto cobrar do cliente | `ctes` (o que cada transportadora cobrou: peso aferido, cubado e taxado, reentregas e devoluções); `faturas_frete`; `indenizacoes`; `cotacoes_frete`; `tabela_frete_*` (vigências); `regras_site_frete_por_uf`; `checkout_conversao` (frete exibido); `politicas` (seção frete) |
| **Reunir informação que hoje está espalhada em vários portais** | Juntar os 5 portais numa visão única por envio | `portal_expressa_ja`, `portal_transnorte`, `portal_rapido_sul` (separador `;`), `portal_vialog` + `portal_vialog_codigos`, `portal_correio_agil` (horário em UTC); `transportadoras` (link de cada portal e o contato) |

### Catálogo

| Sistema | Arquivo | Linhas | O que é |
| --- | --- | ---: | --- |
| ERP e WMS | `envios` | 39.613 | Envio com CEP, peso, transportadora, prazo exibido, data prometida, frete cobrado e cotado, NF e postagem |
| | `envios_expedicao` | 39.613 | Separação, coleta, embalagem, volumes, cubagem, valor declarado, chave da NF-e |
| | `itens_envio` | 89.349 | Itens de cada envio |
| | `produtos` / `embalagens` | 66 / 6 | Peso e dimensões dos produtos e das caixas |
| | `cds` | 2 | Centros de distribuição: CEP, horário de corte, janela de coleta |
| Contratos | `transportadoras` | 5 | Cadastro e contrato: SLA, multa, reentrega, seguro, faturamento, contato, portal |
| | `transportadoras_cobertura_sla` | 250 | Quem atende cada UF e localidade, e em quanto tempo |
| | `tabela_frete_<transportadora>` | 133 a 830 | Tabelas de preço com vigência, cada uma num formato |
| Motor de frete do site | `cotacoes_frete` | 189.805 | Cada transportadora cotada por envio: preço, prazo e qual foi escolhida |
| | `regras_site_*` (4) e `historico_regras_site` | 20 a 261 | Prazo e frete exibidos por prefixo, roteamento padrão e o histórico de versões |
| Portais | `portal_*` (5 + de-para) | 7.595 a 24.236 | Eventos de rastreio dos últimos 60 dias |
| Torre de controle e SAC | `ocorrencias_entrega` / `chamados_transportadoras` / `indenizacoes` | 2.352 / 2.094 / 179 | Ocorrências, chamados e indenizações |
| Financeiro | `ctes` / `faturas_frete` | 38.943 / 25 | CT-e por envio e faturas quinzenais |
| Analytics | `checkout_conversao` | 70.133 | Sessões e pedidos por dia, prefixo, prazo e frete exibidos |
| Concorrência | `concorrentes` / `concorrentes_prazos` | 3 / 7.696 | Concorrentes monitorados e coletas de prazo e frete |
| Cadastros auxiliares | `cabecas_cep` / `feriados` | 492 / 12 | Prefixos de CEP e feriados |
| Regras | `politicas` / `ferramentas` | 53 / 20 | Política de logística e o que o agente pode fazer por papel |

---

## De onde vêm estas bases

- **Origem.** Saem do cenário de treino do kit (`kit_dados/saida/cenario_A_treino/*/publico`), passando por `kit_dados/gerador/montar_bases_csv.py`. Esse script copia e converte os arquivos e chama `completar_bases_atendimento.py`, `completar_bases_pagamentos.py` e `completar_bases_transportes.py`, que acrescentam colunas e criam as tabelas de cada sistema.
- **Para regenerar.** Dentro de `kit_dados/`, rode `python -X utf8 gerador/montar_bases_csv.py` (cerca de 35 s). O resultado é sempre idêntico.
- **O que os scripts conferem.** Os scripts param com erro se um ID apontar para registro inexistente, se aparecer uma data depois do corte em dado que deveria ser passado, se as somas não fecharem entre tabelas, se algum rótulo de resposta vazar ou se um problema plantado deixar de ser detectável.
- **Para mudar volume, período ou problemas plantados.** Ajuste os geradores e as causas em `kit_dados/gerador/` e rode `gerar_e_validar_tudo.sh`, que refaz esta pasta no final.
- **Sem gabarito.** As respostas e os problemas plantados ficam em `kit_dados/saida/*/interno/`, que não vai para o participante.
