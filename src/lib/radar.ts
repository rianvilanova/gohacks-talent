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
  transp: Record<string, { todos: Hist; treino: Hist; teste: Hist; freteMedio: number | null }>;
  fretePorTransp: Record<string, number>;
  concorrentesPrazoMediana: number | null; concorrentesColetas: number;
};

export type Dados = {
  corteBacktest: string; enviosNaAmostra: number; enviosComEntrega: number; enviosPorAno: number;
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
