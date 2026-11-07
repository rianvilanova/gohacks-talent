// Ferramentas que o agente (LLM) pode chamar. Todas leem os dados preparados e usam a lib de contas:
// o modelo nunca calcula nem inventa número, só decide e explica com o que vem daqui.
import dadosJson from "@/data/radar.json";
import {
  type Dados, type AcaoPrefixo, planoAcoes, resumir, recomendada, ehAcaoReal, custo, comMargem, fatorAno,
  noPrazo, total, valorMedio, faixasResumo, efeitoConversao, ROTULO_ACAO,
} from "@/lib/radar";

export const dados = dadosJson as unknown as Dados;

const r0 = (x: number) => Math.round(x);
const pct = (x: number) => Math.round(x * 1000) / 10;

export type Contexto = { meta: number; sensibilidade: number };
export type Proposta = {
  id: string; prefixos: string[]; regiao: string; tipo: string; mudanca: string;
  justificativa: string; valorLiquidoAno: number; atrasosEvitadosAno: number; cancelamentosEvitadosAno: number;
  noPrazoAntes: number; noPrazoDepois: number; status: "aguardando_gerente";
};

const linha = (x: AcaoPrefixo) => ({
  prefixo: x.p3, cidade: x.cidade, uf: x.uf, acao: ROTULO_ACAO[x.acao],
  margem: `${x.margemAtual} -> ${x.margemNova}`, prazo_exibido: `${x.prazoAtual} -> ${x.prazoNovo}`,
  transportadora: x.transportadoraNova ? `${x.transportadoraAtual} -> ${x.transportadoraNova}` : x.transportadoraAtual,
  concorrentes_prazo_mediana: x.concorrentes,
  no_prazo_pct: `${pct(x.noPrazoAntes)} -> ${pct(x.noPrazoDepois)}`,
  atrasos_evitados_ano: r0(x.atrasosEvitados), cancelamentos_evitados_ano: r0(x.cancelamentosEvitados),
  economia_atrasos_rs_ano: r0(x.economiaTotal), efeito_conversao_rs_ano: r0(x.conversao), frete_extra_rs_ano: r0(x.freteExtra),
  valor_liquido_rs_ano: r0(x.valorLiquido), recomendada: recomendada(x),
});

export const DEFINICOES = [
  {
    type: "function", function: {
      name: "resumo_geral",
      description: "Placar geral: % no prazo hoje, atrasos e cancelamentos por ano, custo, potencial do plano completo (meta) e do plano recomendado (só ações com saldo positivo).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function", function: {
      name: "listar_prefixos",
      description: "Lista prefixos de CEP (3 dígitos) com a ação calculada para cada um e o valor em R$/ano. ordem: 'valor' (maior valor líquido primeiro), 'pior_prazo' (menor % no prazo) ou 'prejuizo' (ações que dariam prejuízo). acao filtra por tipo de ação.",
      parameters: {
        type: "object",
        properties: {
          ordem: { type: "string", enum: ["valor", "pior_prazo", "prejuizo"] },
          acao: { type: "string", enum: ["mais_margem", "menos_margem", "rotear", "incidente"] },
          limite: { type: "integer", minimum: 1, maximum: 30 },
        },
        required: ["ordem"],
      },
    },
  },
  {
    type: "function", function: {
      name: "diagnosticar_prefixo",
      description: "Diagnóstico de um prefixo: regra atual do site, % no prazo por transportadora, atrasos por faixa, prazo dos concorrentes, quem atende a região e a ação calculada.",
      parameters: { type: "object", properties: { prefixo: { type: "string", description: "3 dígitos, ex.: 685" } }, required: ["prefixo"] },
    },
  },
  {
    type: "function", function: {
      name: "simular_margem",
      description: "Simula uma margem de segurança (dias úteis, 0 a 6) em um prefixo: % no prazo, atrasos, cancelamentos, R$ de atraso evitado e efeito na conversão, por ano.",
      parameters: {
        type: "object",
        properties: { prefixo: { type: "string" }, margem: { type: "integer", minimum: 0, maximum: 6 } },
        required: ["prefixo", "margem"],
      },
    },
  },
  {
    type: "function", function: {
      name: "propor_mudanca",
      description: "Registra uma proposta para o gerente aprovar (o agente nunca aprova). Uma proposta pode agrupar vários prefixos com a MESMA ação (ex.: todos de SP capital). Aplica a ação calculada de cada prefixo. Máximo de 8 propostas por varredura.",
      parameters: {
        type: "object",
        properties: {
          prefixos: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20, description: "prefixos de 3 dígitos com a mesma ação" },
          regiao: { type: "string", description: "nome curto da região, ex.: SP capital" },
          justificativa: { type: "string", description: "1 a 2 frases em português, citando só números vindos das ferramentas" },
        },
        required: ["prefixos", "regiao", "justificativa"],
      },
    },
  },
] as const;

export function criarExecutor(ctx: Contexto) {
  const plano = planoAcoes(dados, ctx.meta, ctx.sensibilidade);
  const porP3 = new Map(plano.prefixos.map((x) => [x.p3, x]));
  const propostas: Proposta[] = [];
  const fator = fatorAno(dados);

  const ferramentas: Record<string, (a: Record<string, unknown>) => unknown> = {
    resumo_geral: () => {
      const pot = resumir(plano, ehAcaoReal), rec = resumir(plano, recomendada);
      return {
        meta_por_prefixo_pct: pct(ctx.meta), curva_conversao_medida_gap_vs_concorrente: dados.curvaConversao, sensibilidade: ctx.sensibilidade,
        hoje: { no_prazo_pct: pct(plano.antes.noPrazo), atrasos_ano: r0(plano.antes.atrasos), cancelamentos_ano: r0(plano.antes.cancelamentos), custo_direto_rs_ano: r0(plano.antes.direto), custo_com_recompra_rs_ano: r0(plano.antes.total), por_faixa: faixasResumo(plano.antes) },
        potencial_plano_completo: { prefixos: pot.prefixos, no_prazo_pct: pct(pot.noPrazoDepois), atrasos_evitados_ano: r0(pot.atrasosEvitados), cancelamentos_evitados_ano: r0(pot.cancelamentosEvitados), economia_atrasos_rs_ano: r0(pot.economiaTotal), efeito_conversao_rs_ano: r0(pot.conversao), valor_liquido_rs_ano: r0(pot.valorLiquido) },
        recomendado_saldo_positivo: { prefixos: rec.prefixos, no_prazo_pct: pct(rec.noPrazoDepois), atrasos_evitados_ano: r0(rec.atrasosEvitados), cancelamentos_evitados_ano: r0(rec.cancelamentosEvitados), economia_atrasos_rs_ano: r0(rec.economiaTotal), efeito_conversao_rs_ano: r0(rec.conversao), valor_liquido_rs_ano: r0(rec.valorLiquido) },
        acoes: plano.contagem,
      };
    },
    listar_prefixos: (a) => {
      const lim = Math.min(15, Number(a.limite ?? 10)); // limite menor = menos tokens e agente mais rápido
      let l = plano.prefixos.filter(ehAcaoReal).filter((x) => !a.acao || x.acao === a.acao);
      if (a.ordem === "pior_prazo") l = [...l].sort((x, y) => x.noPrazoAntes - y.noPrazoAntes);
      else if (a.ordem === "prejuizo") l = l.filter((x) => x.valorLiquido < 0).sort((x, y) => x.valorLiquido - y.valorLiquido);
      return l.slice(0, lim).map(linha);
    },
    diagnosticar_prefixo: (a) => {
      const p3 = String(a.prefixo).padStart(3, "0");
      const p = dados.prefixos.find((x) => x.p3 === p3), x = porP3.get(p3);
      if (!p || !x) return { erro: `prefixo ${p3} não tem envios na amostra` };
      return {
        ...linha(x),
        regra_atual: p.regra, envios_no_teste: total(p.teste), envios_ano_estimados: r0(total(p.teste) * fator),
        ticket_medio_rs: r0(valorMedio(p.teste)),
        no_prazo_por_transportadora_90d: Object.fromEntries(Object.entries(p.transp).map(([t, T]) => [t, { envios: total(T.todos), no_prazo_pct: pct(noPrazo(T.todos)) }])),
        atrasos_por_faixa_ano_hoje: faixasResumo(x.antes),
        transportadoras_que_atendem: p.atende,
        concorrentes: { prazo_mediana: p.concorrentesPrazoMediana, coletas: p.concorrentesColetas },
      };
    },
    simular_margem: (a) => {
      const p3 = String(a.prefixo).padStart(3, "0"), m = Number(a.margem);
      const p = dados.prefixos.find((x) => x.p3 === p3);
      if (!p || !p.regra) return { erro: `prefixo ${p3} sem regra ou sem envios` };
      const antes = custo(p.teste, fator), depois = custo(comMargem(p.base.teste, m), fator);
      const delta = m - p.regra.margem;
      const conv = efeitoConversao(dados, p, delta, total(p.teste) * fator, ctx.sensibilidade);
      return {
        prefixo: p3, margem: `${p.regra.margem} -> ${m}`, prazo_exibido: `${p.regra.prazo} -> ${p.regra.prazo + delta}`, concorrentes_prazo_mediana: p.concorrentesPrazoMediana,
        no_prazo_pct: `${pct(antes.noPrazo)} -> ${pct(depois.noPrazo)}`,
        atrasos_evitados_ano: r0(antes.atrasos - depois.atrasos), cancelamentos_evitados_ano: r0(antes.cancelamentos - depois.cancelamentos),
        economia_atrasos_rs_ano: r0(antes.total - depois.total), efeito_conversao_rs_ano: r0(conv), valor_liquido_rs_ano: r0(antes.total - depois.total + conv),
      };
    },
    propor_mudanca: (a) => {
      const lista = (Array.isArray(a.prefixos) ? a.prefixos : [a.prefixos]).map((p) => String(p).padStart(3, "0"));
      const xs = lista.map((p3) => porP3.get(p3)).filter((x): x is AcaoPrefixo => !!x && ehAcaoReal(x));
      if (!xs.length) return { erro: "nenhum desses prefixos tem ação a propor" };
      const tipos = new Set(xs.map((x) => x.acao));
      if (tipos.size > 1) return { erro: "os prefixos têm ações diferentes; faça uma proposta por tipo de ação" };
      if (propostas.length >= 8) return { erro: "limite de 8 propostas abertas atingido" };
      const ja = new Set(propostas.flatMap((p) => p.prefixos));
      if (xs.some((x) => ja.has(x.p3))) return { erro: "algum desses prefixos já está em outra proposta" };
      const x0 = xs[0];
      const mudanca = x0.acao === "rotear" ? `rotear de ${x0.transportadoraAtual} para ${x0.transportadoraNova}`
        : x0.acao === "incidente" ? `abrir incidente com a transportadora e ajustar margem ${x0.margemAtual}→${x0.margemNova}`
        : `prazo exibido ${x0.prazoAtual}→${x0.prazoNovo} dias úteis (margem ${x0.margemAtual}→${x0.margemNova})`;
      const soma = (k: "valorLiquido" | "atrasosEvitados" | "cancelamentosEvitados") => r0(xs.reduce((s, x) => s + x[k], 0));
      const env = xs.reduce((s, x) => s + x.antes.envios, 0);
      const p: Proposta = {
        id: `P${propostas.length + 1}`, prefixos: xs.map((x) => x.p3), regiao: String(a.regiao ?? x0.cidade).slice(0, 60),
        tipo: ROTULO_ACAO[x0.acao], mudanca: xs.length > 1 ? mudanca.replace(/^prazo exibido \d+→\d+ dias úteis/, `prazo exibido ${x0.margemNova > x0.margemAtual ? "+" : "−"}${Math.abs(x0.margemNova - x0.margemAtual)} dia(s)`) : mudanca,
        justificativa: String(a.justificativa ?? "").slice(0, 400), valorLiquidoAno: soma("valorLiquido"),
        atrasosEvitadosAno: soma("atrasosEvitados"), cancelamentosEvitadosAno: soma("cancelamentosEvitados"),
        noPrazoAntes: xs.reduce((s, x) => s + x.noPrazoAntes * x.antes.envios, 0) / env,
        noPrazoDepois: xs.reduce((s, x) => s + x.noPrazoDepois * x.antes.envios, 0) / env, status: "aguardando_gerente",
      };
      propostas.push(p);
      const totalPropostas = propostas.reduce((s, q) => s + q.valorLiquidoAno, 0);
      return { ok: true, id: p.id, prefixos: p.prefixos, mudanca: p.mudanca, valor_liquido_rs_ano: p.valorLiquidoAno, total_de_todas_as_propostas_rs_ano: totalPropostas, ignorados: lista.filter((q) => !xs.some((x) => x.p3 === q)) };
    },
  };

  return {
    propostas,
    executar(nome: string, args: Record<string, unknown>) {
      const f = ferramentas[nome];
      if (!f) return { erro: `ferramenta desconhecida: ${nome}` };
      try { return f(args); } catch (e) { return { erro: String(e) }; }
    },
  };
}
