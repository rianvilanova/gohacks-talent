# Contexto: hackathon solo de IA, tempo curto

Estou participando de um hackathon individual de IA.
Tenho **um único dia** para construir, publicar e apresentar uma solução com IA para um desafio de negócio,
usando **apenas dados fictícios** fornecidos pela organização. Trabalho sozinho; você é meu par.

## Horários que mandam no dia (sábado)
- 09h40: escolha do desafio · **16h30: prazo final da submissão** (nada depois disso conta)
- 16h35–18h10: pré-júri (10 min comigo) → Top 10 vai à final no domingo (5 min de pitch + 5 de sabatina)
- 
## Como a banca avalia (0–100)
- **Modelagem 40%**: fluxo funciona de ponta a ponta, uso de agentes/ferramentas, autonomia, eu conferi e corrigi a IA
- **Adaptabilidade 20%**: aprendi rápido um tema que não é meu, usei bem os dados fictícios, mudei de rota quando precisou
- **Conceito 20%**: público claro, necessidade real de negócio, entendível em poucos minutos
- **Aderência cultural 20%**: atitude de dono, colaboração com mentores, abertura a feedback

## Regras de trabalho
1. **Fluxo de ponta a ponta primeiro**, refinamento depois. Prefira o simples que funciona.
2. **Depois das 14h30, me avise** se eu pedir algo que aumente o escopo. Pergunte se vale o risco.
3. Antes de mudanças grandes, diga em 1–2 frases o plano. Mudanças pequenas, faça direto.
4. Lembre-me de fazer commit + push a cada avanço que funciona (o GitHub é obrigatório na submissão).
5. Respostas curtas. Sem tutorial, a menos que eu peça.
6. **Nunca** coloque a chave da API no código, em commits ou em logs. Ela fica em `.env.local` e nas variáveis da Vercel.
7. Nunca invente dados nas saídas do agente: só o que vier das ferramentas e dos dados fornecidos.

## Commits
- Mensagens curtas em português, no formato `tipo: o que mudou`
  - tipos: `feat` (funcionalidade), `fix` (correção), `ia` (prompt/agente/avaliação), `docs`, `chore`
  - ex.: `ia: agente passa a exigir evidência antes de marcar divergência (17/20 → 19/20)`
- Commit a cada avanço que funciona; nunca commitar código quebrado na main
- Quando um commit estiver ligado a um ERRO DA IA ou MUDANÇA DE ROTA do notas.md, cite isso na mensagem
- Antes de cada commit, confira que `.env.local` e chaves não estão incluídos

## Registro contínuo: `notas.md` (obrigatório)
O relatório individual pesa na nota. **Sem que eu precise pedir**, acrescente uma entrada em `notas.md`
(crie o arquivo se não existir) sempre que acontecer algo destes tipos:
- **DECISÃO**: o que escolhemos e por quê (e o que descartamos)
- **ERRO DA IA**: o que a IA (você ou o agente do produto) errou, como percebi e como corrigimos
- **MUDANÇA DE ROTA**: o que não funcionou e para onde fomos
- **TESTE**: casos testados e resultados em números (ex.: 17/20 corretos → 19/20 após ajuste X)
- **FEEDBACK**: o que um mentor ou a banca disse e o que mudei por causa disso
- **APRENDIZADO**: algo do tema do desafio que eu não sabia

Formato de cada entrada (uma linha ou duas, não mais):
`- [HH:MM] TIPO: descrição curta`
Use o horário aproximado. Não registre trivialidades (typos, ajustes de CSS).

## Entregáveis: quando eu disser "modo entrega"
Use `notas.md`, o código e o histórico de commits para gerar, em `entrega/`:
1. `submissao.md`: rascunho dos campos, **respeitando os limites de caracteres** (mostre a contagem):
   nome do projeto (80) · problema (600) · solução (800) · como usou a IA (800) · resultado/impacto esperado (500)
2. `slides.md`: roteiro de 5–10 slides: Problema → Solução → Demo → Impacto → Próximos passos (máx. 3 elementos por slide)
3. `pitch.md`: roteiro de 5 minutos com tempos, e a frase "Minha solução é [nome]: um agente que [ação], para que [resultado]"
4. `sabatina.md`: 8 perguntas prováveis da banca com respostas curtas (como funciona, quem usa, o que falta, como medir)
5. `relatorio.md`: relatório individual em 1ª pessoa, contando como pensei, decidi e corrigi a IA, com base nas notas

## Checklist antes das 16h30
- [ ] `npm run build` local sem erros · último push feito · deploy verde
- [ ] Link do app testado em janela anônima **chamando a IA de verdade**
- [ ] Repositório público com README (o que é, como rodar)
- [ ] Prints/GIF da demo salvos (plano B)
- [ ] Slides exportados em PDF (até 10 slides, até 20 MB)
- [ ] Declaração lida e marcada
