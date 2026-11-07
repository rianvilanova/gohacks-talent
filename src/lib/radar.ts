// Contas do Radar de Prazo. Tudo determinístico: o agente (LLM) só chama estas funções.
// Custos e probabilidades: data/transportes/parametros.md ("Custo de quebrar o prazo").

export type Hist = { n: number[]; v: number[] }; // índice = dias úteis de atraso (0 = no prazo); v = soma do valor dos pedidos

export type Regra = {
  cidade: string; uf: string; localidade: string; transportadora: string;
  sla: number; margem: number; prazo: number; frete: number;
};

export type Prefixo = {
  p3: string; uf: string; cidade: string; regra: Regra | null;
  atende: { transportadora: string; sla: number }[];
  todos: Hist; treino: Hist; teste: Hist;
  base: { treino: Hist; teste: Hist }; // atraso vs promessa SEM margem, índice = dias + 15 (negativo = adiantado)
  transp: Record<string, { todos: Hist; treino: Hist; teste: Hist; base: { treino: Hist; teste: Hist }; freteMedio: number | null }>;
  fretePorTransp: Record<string, number>;
  concorrentesPrazoMediana: number | null; concorrentesColetas: number;
};

export type Dados = {
  corteBacktest: string; enviosNaAmostra: number; enviosComEntrega: number; enviosPorAno: number;
  tiktok?: { fatia_das_vendas: number; corte_das_vendas_abaixo_da_regua: number; regua_cumprimento_loja: number; _fonte?: string };
  curvaConversao: Record<string, number>; // gap de prazo vs concorrente (dias) -> conversão relativa ao gap 0, medida no checkout
  geral: { todos: Hist; treino: Hist; teste: Hist };
  porTransp: Record<string, Hist>;
  prefixos: Prefixo[];
};

export const PARAMS = {
  custoContato: 9,
  margemContribuicao: 0.55,
  logisticaReversa: 12,
  recompraPerdida: (0.28 - 0.14) * 2, // pedidos perdidos por cliente atrasado em 12 meses
  metaPorPrefixo: 0.92,
  minEnviosPrefixo: 30,
  // Estimativa a partir do caso real de SP (01/10: +2 dias -> conversão 39,4% -> 34,3%, -12,9%): ~6,5% por dia.
  quedaConversaoPorDia: 0.065,
  folgaReguaTiktok: 0.005, // mira 92,5% para não ficar no fio da régua de 92%
};

export const FAIXAS = [
  { id: "1-2", de: 1, ate: 2, probContato: 0.35, probCancel: 0.04 },
  { id: "3-5", de: 3, ate: 5, probContato: 0.6, probCancel: 0.1 },
  { id: "6-10", de: 6, ate: 10, probContato: 0.85, probCancel: 0.22 },
  { id: ">10", de: 11, ate: Infinity, probContato: 0.85, probCancel: 0.4 },
] as const;

export const faixaDe = (d: number) => FAIXAS.find((f) => d >= f.de && d <= f.ate) ?? null;

export const vazio = (len = 16): Hist => ({ n: Array(len).fill(0), v: Array(len).fill(0) });

export function soma(...hs: Hist[]): Hist {
  const r = vazio(hs[0]?.n.length ?? 16);
  for (const h of hs) h.n.forEach((x, i) => { r.n[i] += x; r.v[i] += h.v[i]; });
  return r;
}

/** Aplica k dias de margem: quem atrasou d dias passa a atrasar max(0, d-k). */
export function deslocar(h: Hist, k: number): Hist {
  if (k <= 0) return h;
  const r = vazio(h.n.length);
  h.n.forEach((x, i) => { const j = Math.max(0, i - k); r.n[j] += x; r.v[j] += h.v[i]; });
  return r;
}

export const total = (h: Hist) => h.n.reduce((a, b) => a + b, 0);
export const noPrazo = (h: Hist) => (total(h) ? h.n[0] / total(h) : 0);
export const valorMedio = (h: Hist) => { const t = total(h); return t ? h.v.reduce((a, b) => a + b, 0) / t : 0; };

export type Custo = {
  envios: number; atrasos: number; noPrazo: number; cancelamentos: number;
  contato: number; cancelamento: number; recompra: number; direto: number; total: number;
  porFaixa: Record<string, { atrasos: number; cancelamentos: number; contato: number; cancelamento: number; recompra: number }>;
};

/** Custo esperado dos atrasos de um histograma, multiplicado por `fator` (ex.: anualização). */
export function custo(h: Hist, fator = 1): Custo {
  const porFaixa: Custo["porFaixa"] = {};
  for (const f of FAIXAS) porFaixa[f.id] = { atrasos: 0, cancelamentos: 0, contato: 0, cancelamento: 0, recompra: 0 };
  h.n.forEach((n, d) => {
    const f = faixaDe(d); if (!f || !n) return;
    const p = porFaixa[f.id], v = h.v[d];
    p.atrasos += n * fator;
    p.cancelamentos += n * f.probCancel * fator;
    p.contato += n * PARAMS.custoContato * f.probContato * fator;
    p.cancelamento += f.probCancel * (PARAMS.margemContribuicao * v + PARAMS.logisticaReversa * n) * fator;
    p.recompra += PARAMS.recompraPerdida * PARAMS.margemContribuicao * v * fator;
  });
  const s = (k: keyof Custo["porFaixa"][string]) => Object.values(porFaixa).reduce((a, p) => a + p[k], 0);
  const contato = s("contato"), cancelamento = s("cancelamento"), recompra = s("recompra");
  return {
    envios: total(h) * fator, atrasos: s("atrasos"), noPrazo: noPrazo(h), cancelamentos: s("cancelamentos"),
    contato, cancelamento, recompra, direto: contato + cancelamento, total: contato + cancelamento + recompra, porFaixa,
  };
}

/** Menor margem (0..max dias) que leva o histograma à meta. null se não há envios suficientes. */
export function margemMinima(h: Hist, meta = PARAMS.metaPorPrefixo, max = 3, minN = PARAMS.minEnviosPrefixo): number | null {
  if (total(h) < minN) return null;
  for (let k = 0; k <= max; k++) if (noPrazo(deslocar(h, k)) >= meta) return k;
  return max;
}

/** Fator para levar o período de teste a 1 ano. */
export const fatorAno = (d: Dados) => d.enviosPorAno / total(d.geral.teste);

/** Venda perdida estimada por prazo maior: só conta dias que nos deixam atrás da mediana dos concorrentes. */
export function vendaPerdida(p: Prefixo, k: number, fator: number) {
  if (k <= 0 || !p.regra) return { diasAtras: 0, pedidos: 0, reais: 0 };
  const base = p.regra.prazo, novo = base + k;
  const ref = Math.max(base, p.concorrentesPrazoMediana ?? base);
  const diasAtras = Math.max(0, novo - ref);
  const pedidos = total(p.teste) * fator * PARAMS.quedaConversaoPorDia * diasAtras;
  return { diasAtras, pedidos, reais: pedidos * PARAMS.margemContribuicao * valorMedio(p.teste) };
}

/** Efeito em R$/ano (margem de contribuição) de mudar o prazo exibido em delta dias, pela curva medida no checkout. */
export function efeitoConversao(d: Dados, p: Prefixo, delta: number, enviosAno: number, sensibilidade = 1) {
  if (!delta || !p.regra) return 0;
  const c = d.curvaConversao, ks = Object.keys(c).map(Number), lo = Math.min(...ks), hi = Math.max(...ks);
  const f = (g: number) => c[String(Math.max(lo, Math.min(hi, g)))] ?? 1;
  const gap = p.regra.prazo - (p.concorrentesPrazoMediana ?? p.regra.prazo);
  const fator = f(gap + delta) / f(gap) - 1; // ex.: -0,15 = 15% menos pedidos
  return enviosAno * sensibilidade * fator * PARAMS.margemContribuicao * valorMedio(p.teste);
}

export type Plano = {
  meta: number;
  antes: Custo; depois: Custo;
  vendaPerdida: number; economiaDireta: number; economiaTotal: number; liquidoDireto: number;
  prefixosAlterados: number; diasExtrasMedios: number;
  porPrefixo: { p3: string; k: number; antes: Custo; depois: Custo; vendaPerdida: number; liquido: number }[];
};

/** Backtest: aprende a margem mínima por prefixo no treino e mede no teste, anualizado. */
export function planoMargens(d: Dados, meta = PARAMS.metaPorPrefixo, so_liquido_positivo = false): Plano {
  const fator = fatorAno(d);
  const porPrefixo: Plano["porPrefixo"] = [];
  const hsAntes: Hist[] = [], hsDepois: Hist[] = [];
  let diasExtras = 0, perda = 0;
  for (const p of d.prefixos) {
    let k = margemMinima(p.treino, meta) ?? 0;
    const antes = custo(p.teste, fator);
    let depois = custo(deslocar(p.teste, k), fator);
    let vp = vendaPerdida(p, k, fator).reais;
    if (so_liquido_positivo && k > 0 && antes.direto - depois.direto - vp <= 0) { k = 0; depois = antes; vp = 0; }
    hsAntes.push(p.teste); hsDepois.push(deslocar(p.teste, k));
    diasExtras += k * total(p.teste); perda += vp;
    porPrefixo.push({ p3: p.p3, k, antes, depois, vendaPerdida: vp, liquido: antes.direto - depois.direto - vp });
  }
  const antes = custo(soma(...hsAntes), fator), depois = custo(soma(...hsDepois), fator);
  return {
    meta, antes, depois, vendaPerdida: perda,
    economiaDireta: antes.direto - depois.direto, economiaTotal: antes.total - depois.total,
    liquidoDireto: antes.direto - depois.direto - perda,
    prefixosAlterados: porPrefixo.filter((x) => x.k > 0).length,
    diasExtrasMedios: diasExtras / total(soma(...hsAntes)),
    porPrefixo,
  };
}

// ======================= Plano de ação para todos os prefixos =======================

export const BASE = 15;

/** Converte o histograma "base" (sem margem) no histograma de atraso com margem m. */
export function comMargem(b: Hist, m: number): Hist {
  const r = vazio(16);
  b.n.forEach((x, i) => {
    if (!x) return;
    const d = Math.min(15, Math.max(0, i - BASE - m));
    r.n[d] += x; r.v[d] += b.v[i];
  });
  return r;
}

const escala = (h: Hist, k: number): Hist => ({ n: h.n.map((x) => x * k), v: h.v.map((x) => x * k) });

export type Acao = "manter" | "mais_margem" | "menos_margem" | "rotear" | "incidente" | "sem_dados";

export type AcaoPrefixo = {
  p3: string; cidade: string; uf: string; acao: Acao;
  margemAtual: number; margemNova: number; prazoAtual: number | null; prazoNovo: number | null;
  transportadoraAtual: string | null; transportadoraNova: string | null;
  concorrentes: number | null; enviosAno: number;
  noPrazoAntes: number; noPrazoDepois: number;
  atrasosEvitados: number; cancelamentosEvitados: number;
  economiaDireta: number; economiaRecompra: number; economiaTotal: number;
  conversao: number; // R$ de margem: + vendas ganhas (prazo menor), - vendas perdidas (prazo maior)
  freteExtra: number;
  valorLiquido: number; // economiaTotal + conversao - freteExtra
  antes: Custo; depois: Custo;
  selecionada: boolean; // entra no plano recomendado
  peloTiktok: boolean; // entrou só para a loja passar da régua do TikTok Shop
  estimadoPor: string | null; // poucos envios próprios: margem aprendida no histórico dos vizinhos (ex.: "PA interior · TransNorte · 5 prefixos")
};

/**
 * Prefixo com poucos envios: soma o treino (sem margem) dos prefixos da mesma UF, localidade e transportadora padrão;
 * se ainda faltar volume, só UF + transportadora. Só dados reais; o resultado continua medido no teste do próprio prefixo.
 */
function vizinhos(d: Dados, p: Prefixo): { treino: Hist; rotulo: string } | null {
  if (!p.regra) return null;
  const r = p.regra;
  const niveis: [string, (q: Prefixo) => boolean][] = [
    [`${r.uf} ${r.localidade} · ${r.transportadora}`, (q) => q.regra?.uf === r.uf && q.regra?.localidade === r.localidade && q.regra?.transportadora === r.transportadora],
    [`${r.uf} · ${r.transportadora}`, (q) => q.regra?.uf === r.uf && q.regra?.transportadora === r.transportadora],
  ];
  for (const [rotulo, filtro] of niveis) {
    const qs = d.prefixos.filter(filtro);
    const treino = soma(...qs.map((q) => q.base.treino));
    if (qs.length > 1 && total(treino) >= PARAMS.minEnviosPrefixo) return { treino, rotulo: `${rotulo} · ${qs.length} prefixos, ${total(treino)} envios` };
  }
  return null;
}

/** SLA contratual (dias úteis) da transportadora t na região do prefixo (cobertura); prazo exibido = 1 + SLA + margem. */
export function slaDe(p: Prefixo, t: string | null | undefined): number | null {
  if (!t) return null;
  const a = p.atende.find((x) => x.transportadora === t);
  if (a) return a.sla;
  return p.regra && p.regra.transportadora === t ? p.regra.sla : null;
}

export type EfeitoTiktok = {
  fatia: number; corte: number; regua: number;
  noPrazoLojaHoje: number; noPrazoLojaPlano: number;
  capadoHoje: boolean; destravado: boolean;
  pedidosRecuperadosAno: number; valorAno: number; // margem de contribuição recuperada ao sair do corte
  custoDasAcoesExtras: number; prefixosExtras: number;
};

export type PlanoAcoes = {
  meta: number; sensibilidade: number;
  antes: Custo; depois: Custo;
  atrasosEvitados: number; cancelamentosEvitados: number;
  economiaDireta: number; economiaTotal: number; conversao: number; freteExtra: number; valorLiquido: number;
  contagem: Record<Acao, number>;
  prefixos: AcaoPrefixo[];
  tiktok: EfeitoTiktok | null;
};

/** Menor margem absoluta (0..max) que leva o histograma base à meta; null se nenhuma chega. */
function margemParaMeta(b: Hist, meta: number, max: number): number | null {
  for (let m = 0; m <= max; m++) if (noPrazo(comMargem(b, m)) >= meta) return m;
  return null;
}

/**
 * Para cada prefixo: aprende no treino a menor margem que cumpre a meta (pode ser menor que a atual)
 * e se outra transportadora que atende a região cumpre com menos margem; avalia no teste e anualiza.
 */
export function planoAcoes(d: Dados, meta = 0.95, sensibilidade = 1, usarTiktok = true): PlanoAcoes {
  const fator = fatorAno(d);
  const tk = usarTiktok && d.tiktok ? d.tiktok : null;
  const fatiaSite = 1 - (tk?.fatia_das_vendas ?? 0); // a curva de conversão é do checkout do site
  const lista: AcaoPrefixo[] = [];
  const hsAntes: Hist[] = [], hsDepois: Hist[] = [];
  for (const p of d.prefixos) {
    const cur = p.regra?.margem ?? 0, prazo = p.regra?.prazo ?? null;
    const enviosAno = total(p.teste) * fator, vm = valorMedio(p.teste);
    const antes = custo(p.teste, fator);
    let acao: Acao = "manter", m = cur, transpNova: string | null = null, hDepois = p.teste, freteExtra = 0;
    let deltaPrazo: number | null = null; // mudança no prazo exibido (dias); só difere de m - cur quando troca de transportadora
    const poucos = total(p.base.treino) < PARAMS.minEnviosPrefixo;
    const viz = poucos && total(p.base.teste) > 0 ? vizinhos(d, p) : null;
    const treinoRef = viz ? viz.treino : p.base.treino;

    if ((poucos && !viz) || total(p.base.teste) === 0) acao = "sem_dados";
    else {
      const mm = margemParaMeta(treinoRef, meta, cur + 3);
      m = mm ?? cur + 1; // se nem +3 cumpre, o problema é a transportadora: +1 e incidente
      // rota: transportadora que atende, com histórico no prefixo, cumprindo com menos margem
      const atende = new Set(p.atende.map((a) => a.transportadora));
      // prazo exibido = 1 + SLA da transportadora + margem: a troca vale se a PROMESSA total ficar menor para a mesma meta
      const slaAtual = p.regra?.sla ?? 0;
      let melhor: { t: string; m: number; promessa: number } | null = null;
      for (const [t, T] of Object.entries(viz ? {} : p.transp)) { // rota exige histórico próprio
        if (!atende.has(t) || t === p.regra?.transportadora) continue;
        if (total(T.base.treino) < 20 || total(T.base.teste) < 10) continue;
        const slaT = slaDe(p, t); if (slaT === null) continue;
        const mt = margemParaMeta(T.base.treino, meta, cur + 3);
        if (mt === null) continue;
        const promessa = slaT + mt;
        if (promessa < slaAtual + m && (!melhor || promessa < melhor.promessa)) melhor = { t, m: mt, promessa };
      }
      if (melhor) {
        const T = p.transp[melhor.t];
        transpNova = melhor.t; m = melhor.m; acao = "rotear"; deltaPrazo = melhor.promessa - (slaAtual + cur);
        hDepois = comMargem(escala(T.base.teste, total(p.teste) / total(T.base.teste)), m);
        const fAtual = p.regra ? p.fretePorTransp[p.regra.transportadora] : undefined, fNovo = p.fretePorTransp[melhor.t];
        if (fAtual && fNovo) freteExtra = Math.max(0, fNovo - fAtual) * enviosAno;
      } else if (mm === null) { acao = "incidente"; hDepois = comMargem(p.base.teste, m); }
      else if (m > cur) { acao = "mais_margem"; hDepois = comMargem(p.base.teste, m); }
      else if (m < cur) { acao = "menos_margem"; hDepois = comMargem(p.base.teste, m); }
    }
    const depois = custo(hDepois, fator);
    // conversão: curva medida no checkout (nosso prazo vs concorrentes)
    const dPrazo = deltaPrazo ?? (m - cur);
    const conversao = prazo !== null && dPrazo !== 0 ? efeitoConversao(d, p, dPrazo, enviosAno * fatiaSite, sensibilidade) : 0;
    void vm;
    const economiaDireta = antes.direto - depois.direto, economiaTotal = antes.total - depois.total;
    hsAntes.push(p.teste); hsDepois.push(hDepois);
    lista.push({
      p3: p.p3, cidade: p.cidade, uf: p.uf, acao, margemAtual: cur, margemNova: m,
      prazoAtual: prazo, prazoNovo: prazo === null ? null : prazo + dPrazo,
      transportadoraAtual: p.regra?.transportadora ?? null, transportadoraNova: transpNova,
      concorrentes: p.concorrentesPrazoMediana, enviosAno,
      noPrazoAntes: antes.noPrazo, noPrazoDepois: depois.noPrazo,
      atrasosEvitados: antes.atrasos - depois.atrasos, cancelamentosEvitados: antes.cancelamentos - depois.cancelamentos,
      economiaDireta, economiaRecompra: economiaTotal - economiaDireta, economiaTotal,
      conversao, freteExtra, valorLiquido: economiaTotal + conversao - freteExtra, antes, depois,
      selecionada: false, peloTiktok: false, estimadoPor: viz && acao !== "sem_dados" ? viz.rotulo : null,
    });
  }

  // ---- seleção: primeiro tudo que tem saldo positivo ----
  const real = (x: AcaoPrefixo) => x.acao !== "manter" && x.acao !== "sem_dados";
  for (const x of lista) x.selecionada = real(x) && x.valorLiquido > 0;
  const totEnv = lista.reduce((a, x) => a + x.antes.envios, 0);
  const lojaNoPrazo = (sel: (x: AcaoPrefixo) => boolean) => lista.reduce((a, x) => a + (sel(x) ? x.depois : x.antes).noPrazo * x.antes.envios, 0) / totEnv;
  const lojaHoje = lojaNoPrazo(() => false);
  let tiktok: EfeitoTiktok | null = null;
  if (tk) {
    // TikTok Shop: abaixo da régua (loja inteira) as vendas lá são cortadas. Passar da régua recupera esse corte.
    const pedidosAno = totEnv;
    const vmLoja = lista.reduce((a, x) => a + x.antes.envios * valorMedio(d.prefixos.find((p) => p.p3 === x.p3)!.teste), 0) / totEnv;
    const recuperados = pedidosAno * tk.fatia_das_vendas * (1 / (1 - tk.corte_das_vendas_abaixo_da_regua) - 1);
    const valorTiktok = recuperados * PARAMS.margemContribuicao * vmLoja;
    // se as ações positivas não bastam, adiciona as que custam menos por atraso evitado até passar da régua
    const extras: AcaoPrefixo[] = [];
    const alvo = tk.regua_cumprimento_loja + PARAMS.folgaReguaTiktok; // folga: a régua é medida pela plataforma, não por nós
    if (lojaNoPrazo((x) => x.selecionada) < alvo) {
      const cand = lista.filter((x) => real(x) && !x.selecionada && x.atrasosEvitados > 0)
        .sort((a, b) => b.valorLiquido / b.atrasosEvitados - a.valorLiquido / a.atrasosEvitados);
      for (const x of cand) {
        x.selecionada = true; extras.push(x);
        if (lojaNoPrazo((y) => y.selecionada) >= alvo) break;
      }
    }
    const passou = lojaNoPrazo((x) => x.selecionada) >= alvo;
    const custoExtras = extras.reduce((a, x) => a + x.valorLiquido, 0);
    const vale = passou && valorTiktok + custoExtras > 0;
    if (!vale) for (const x of extras) x.selecionada = false; else for (const x of extras) x.peloTiktok = true;
    tiktok = {
      fatia: tk.fatia_das_vendas, corte: tk.corte_das_vendas_abaixo_da_regua, regua: tk.regua_cumprimento_loja,
      noPrazoLojaHoje: lojaHoje, noPrazoLojaPlano: lojaNoPrazo((x) => x.selecionada),
      capadoHoje: lojaHoje < tk.regua_cumprimento_loja, destravado: vale || (lojaHoje < tk.regua_cumprimento_loja && lojaNoPrazo((x) => x.selecionada) >= tk.regua_cumprimento_loja),
      pedidosRecuperadosAno: vale ? recuperados : 0, valorAno: vale ? valorTiktok : 0,
      custoDasAcoesExtras: vale ? custoExtras : 0, prefixosExtras: vale ? extras.length : 0,
    };
  }
  const A = custo(soma(...hsAntes), fator), D = custo(soma(...hsDepois), fator);
  const s = (k: "conversao" | "freteExtra") => lista.reduce((a, x) => a + x[k], 0);
  const contagem = { manter: 0, mais_margem: 0, menos_margem: 0, rotear: 0, incidente: 0, sem_dados: 0 } as Record<Acao, number>;
  lista.forEach((x) => contagem[x.acao]++);
  const conversao = s("conversao"), freteExtra = s("freteExtra");
  return {
    meta, sensibilidade, antes: A, depois: D,
    atrasosEvitados: A.atrasos - D.atrasos, cancelamentosEvitados: A.cancelamentos - D.cancelamentos,
    economiaDireta: A.direto - D.direto, economiaTotal: A.total - D.total, conversao, freteExtra,
    valorLiquido: A.total - D.total + conversao - freteExtra, contagem,
    prefixos: lista.sort((a, b) => b.valorLiquido - a.valorLiquido),
    tiktok,
  };
}

/** Resume um subconjunto de ações (ex.: só as de saldo positivo) aplicado sobre o plano. */
export function resumir(plano: PlanoAcoes, incluir: (x: AcaoPrefixo) => boolean) {
  let envios = 0, noPrazoAntes = 0, noPrazoDepois = 0;
  const r = { prefixos: 0, atrasosEvitados: 0, cancelamentosEvitados: 0, economiaDireta: 0, economiaTotal: 0, conversao: 0, freteExtra: 0, valorLiquido: 0 };
  for (const x of plano.prefixos) {
    const usa = incluir(x);
    envios += x.antes.envios;
    noPrazoAntes += x.antes.noPrazo * x.antes.envios;
    noPrazoDepois += (usa ? x.depois : x.antes).noPrazo * x.antes.envios;
    if (!usa) continue;
    r.prefixos++; r.atrasosEvitados += x.atrasosEvitados; r.cancelamentosEvitados += x.cancelamentosEvitados;
    r.economiaDireta += x.economiaDireta; r.economiaTotal += x.economiaTotal; r.conversao += x.conversao;
    r.freteExtra += x.freteExtra; r.valorLiquido += x.valorLiquido;
  }
  return { ...r, noPrazoAntes: noPrazoAntes / envios, noPrazoDepois: noPrazoDepois / envios };
}

export const ehAcaoReal = (x: AcaoPrefixo) => x.acao !== "manter" && x.acao !== "sem_dados";
export const recomendada = (x: AcaoPrefixo) => x.selecionada;

export const ROTULO_ACAO: Record<Acao, string> = {
  manter: "Manter", mais_margem: "+ prazo", menos_margem: "− prazo", rotear: "Rotear", incidente: "Incidente", sem_dados: "Poucos dados",
};

/** Atrasos por faixa (anual) de um custo, para tabelas e para o agente. */
export const faixasResumo = (c: Custo) => Object.fromEntries(
  Object.entries(c.porFaixa).map(([k, v]) => [k, { atrasos: Math.round(v.atrasos), cancelamentos: Math.round(v.cancelamentos) }]),
);

// ======================= Veredito (todo prefixo recebe um) e torre por envio =======================

export type Veredito = "saudavel" | "prazo_curto" | "prazo_sobrando" | "transportadora_falhando" | "transportadora_melhor" | "monitorar" | "poucos_dados";
export const ROTULO_VEREDITO: Record<Veredito, string> = {
  saudavel: "Saudável", prazo_sobrando: "Prazo sobrando", prazo_curto: "Prazo curto",
  transportadora_falhando: "Transportadora falhando", transportadora_melhor: "Há transportadora melhor",
  monitorar: "Abaixo da meta, mexer não compensa", poucos_dados: "Poucos dados",
};
/** Diagnóstico de todo prefixo. Só vira ação quando a ação é recomendada (saldo positivo). */
export function veredito(x: AcaoPrefixo): Veredito {
  if (x.acao === "sem_dados") return "poucos_dados";
  if (recomendada(x)) {
    if (x.acao === "menos_margem") return "prazo_sobrando";
    if (x.acao === "mais_margem") return "prazo_curto";
    if (x.acao === "incidente") return "transportadora_falhando";
    if (x.acao === "rotear") return "transportadora_melhor";
  }
  return x.noPrazoAntes >= PARAMS.metaPorPrefixo ? "saudavel" : "monitorar";
}

export type EnvioRisco = { id: string; p3: string; uf: string; t: string; cod: string; ultimoEvento: string; ultimoEm: string; paradoDiasUteis: number; prometida: string; vencido: boolean; valor: number };
export type MultaTransp = { transportadora: string; metaContrato: number; multaPctDia: number; tetoPct: number; noPrazoEntregues: number; atrasadosAno: number; multaDevidaAno: number };
export type Torre = { naoPostados: [string, string, string, string, number, string][]; emRisco: EnvioRisco[]; multaTransportadoras: MultaTransp[] };

export type Roteamento = { id: string; p3: string; uf: string; de: string; para: string; noPrazoDe: number; noPrazoPara: number; freteExtra: number };

/**
 * rotear_envio para os envios ainda não postados: troca para a transportadora que atende a região
 * e cumpre mais no prefixo (histórico do treino, ≥20 envios, ganho ≥5 p.p.), no máximo 40% dos envios da UF no dia.
 */
export function rotearNaoPostados(d: Dados & { torre: Torre }) {
  const porP3 = new Map(d.prefixos.map((p) => [p.p3, p]));
  const taxa = (h: Hist, m: number) => noPrazo(comMargem(h, m));
  const totalUfDia = new Map<string, number>(), usadoUfDia = new Map<string, number>();
  for (const [, , uf, , , dia] of d.torre.naoPostados) totalUfDia.set(uf + dia, (totalUfDia.get(uf + dia) ?? 0) + 1);
  const roteados: Roteamento[] = [];
  let analisados = 0, bloqueadosLimite = 0;
  for (const [id, p3, uf, t, , dia] of d.torre.naoPostados) {
    const p = porP3.get(p3); if (!p || !p.regra) continue;
    analisados++;
    const m = p.regra.margem, atende = new Set(p.atende.map((a) => a.transportadora));
    const atual = p.transp[t] && total(p.transp[t].base.treino) >= 20 ? taxa(p.transp[t].base.treino, m) : taxa(p.base.treino, m);
    const sla0 = slaDe(p, t) ?? p.regra.sla;
    let melhor: { t: string; r: number } | null = null;
    for (const [tt, T] of Object.entries(p.transp)) {
      if (tt === t || !atende.has(tt) || total(T.base.treino) < 20) continue;
      const slaT = slaDe(p, tt); if (slaT === null) continue;
      // o cliente já recebeu a data calculada com o SLA original: SLA maior na nova transportadora consome a margem
      const r = taxa(T.base.treino, m + sla0 - slaT);
      if (r - atual >= 0.05 && (!melhor || r > melhor.r)) melhor = { t: tt, r };
    }
    if (!melhor) continue;
    const k = uf + dia, usado = usadoUfDia.get(k) ?? 0;
    if (usado + 1 > 0.4 * (totalUfDia.get(k) ?? 0)) { bloqueadosLimite++; continue; }
    usadoUfDia.set(k, usado + 1);
    const fd = p.fretePorTransp[t], fp = p.fretePorTransp[melhor.t];
    roteados.push({ id, p3, uf, de: t, para: melhor.t, noPrazoDe: atual, noPrazoPara: melhor.r, freteExtra: fd && fp ? fp - fd : 0 });
  }
  const atrasosEvitadosFila = roteados.reduce((s, r) => s + (r.noPrazoPara - r.noPrazoDe), 0);
  return { analisados, roteados, bloqueadosLimite, atrasosEvitadosFila, freteExtraFila: roteados.reduce((s, r) => s + r.freteExtra, 0) };
}

/** Estimativa anual da rota por pedido (fila de ~3 dias da amostra 1/6), com o custo médio de um atraso no modelo. */
export function valorRoteamentoAno(d: Dados & { torre: Torre }, plano: PlanoAcoes) {
  const r = rotearNaoPostados(d);
  const dias = new Set(d.torre.naoPostados.map((x) => x[5])).size || 1;
  const fAno = (365 / dias) * 6;
  const porAtraso = plano.antes.atrasos ? plano.antes.total / plano.antes.atrasos : 0;
  return {
    ...r, parcela: r.analisados ? r.roteados.length / r.analisados : 0,
    atrasosEvitadosAno: r.atrasosEvitadosFila * fAno, valorAno: r.atrasosEvitadosFila * fAno * porAtraso, freteAno: r.freteExtraFila * fAno,
  };
}
