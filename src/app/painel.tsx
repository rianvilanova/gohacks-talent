"use client";

import { useMemo, useRef, useState } from "react";
import dadosJson from "@/data/radar.json";
import {
  type Dados, type Acao, type AcaoPrefixo, planoAcoes, resumir, recomendada, ehAcaoReal, FAIXAS, ROTULO_ACAO,
} from "@/lib/radar";
import type { Proposta } from "@/lib/ferramentas";

const dados = dadosJson as unknown as Dados;

// ---------- formatação ----------
const int = (x: number) => Math.round(x).toLocaleString("pt-BR");
const pct = (x: number) => (x * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
function brl(x: number) {
  const s = x < 0 ? "−" : "", a = Math.abs(x);
  if (a >= 1e6) return `${s}R$ ${(a / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
  if (a >= 1e3) return `${s}R$ ${Math.round(a / 1e3).toLocaleString("pt-BR")} mil`;
  return `${s}R$ ${Math.round(a)}`;
}

const COR_ACAO: Record<Acao, string> = {
  menos_margem: "bg-emerald-100 text-emerald-800",
  mais_margem: "bg-amber-100 text-amber-800",
  rotear: "bg-sky-100 text-sky-800",
  incidente: "bg-rose-100 text-rose-800",
  manter: "bg-slate-100 text-slate-600",
  sem_dados: "bg-slate-100 text-slate-400",
};

type Evento =
  | { tipo: "ferramenta"; nome: string; args: Record<string, unknown>; resultado: unknown }
  | { tipo: "pensamento" | "final" | "erro"; texto: string }
  | { tipo: "fim"; propostas: Proposta[]; uso: { modelo: string; tokensEntrada: number; tokensSaida: number } };

function rotuloFerramenta(e: Extract<Evento, { tipo: "ferramenta" }>) {
  const a = e.args;
  switch (e.nome) {
    case "resumo_geral": return "Leu o placar geral dos 154 prefixos";
    case "listar_prefixos": return `Listou prefixos por ${a.ordem === "pior_prazo" ? "pior prazo" : a.ordem === "prejuizo" ? "ações que dariam prejuízo" : "valor"}${a.acao ? ` (${ROTULO_ACAO[a.acao as Acao]})` : ""}`;
    case "diagnosticar_prefixo": return `Diagnosticou o prefixo ${a.prefixo}`;
    case "simular_margem": return `Simulou margem de ${a.margem} dia(s) no prefixo ${a.prefixo}`;
    case "propor_mudanca": return `Abriu proposta: ${a.regiao ?? ""} (${(a.prefixos as string[] | undefined)?.join(", ")})`;
    default: return e.nome;
  }
}

function Kpi({ titulo, valor, sub, destaque }: { titulo: string; valor: string; sub?: string; destaque?: "verde" | "azul" }) {
  const cor = destaque === "verde" ? "border-emerald-300 bg-emerald-50" : destaque === "azul" ? "border-sky-300 bg-sky-50" : "border-slate-200 bg-white";
  return (
    <div className={`rounded-xl border p-4 ${cor}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{titulo}</div>
      <div className="num mt-1 text-2xl font-semibold">{valor}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export default function Painel() {
  const [meta, setMeta] = useState(0.95);
  const [queda, setQueda] = useState(0.065);
  const [filtro, setFiltro] = useState<Acao | "todas" | "recomendadas">("recomendadas");
  const [aberto, setAberto] = useState<string | null>(null);

  const plano = useMemo(() => planoAcoes(dados, meta, queda), [meta, queda]);
  const pot = useMemo(() => resumir(plano, ehAcaoReal), [plano]);
  const rec = useMemo(() => resumir(plano, recomendada), [plano]);

  // ---------- agente ----------
  const [rodando, setRodando] = useState(false);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [propostas, setPropostas] = useState<Proposta[]>([]);
  const [decisoes, setDecisoes] = useState<Record<string, "aprovada" | "recusada">>({});
  const [uso, setUso] = useState<string>("");
  const [pergunta, setPergunta] = useState("");
  const fimRef = useRef<HTMLDivElement>(null);

  async function rodarAgente(textoPergunta?: string) {
    setRodando(true); setEventos([]); setUso("");
    if (!textoPergunta) { setPropostas([]); setDecisoes({}); }
    try {
      const r = await fetch("/api/agente", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meta, quedaConversaoPorDia: queda, pergunta: textoPergunta }),
      });
      if (!r.body) throw new Error(`HTTP ${r.status}`);
      const leitor = r.body.getReader(), dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const linhas = buf.split("\n"); buf = linhas.pop() ?? "";
        for (const l of linhas) {
          if (!l.trim()) continue;
          const ev = JSON.parse(l) as Evento;
          if (ev.tipo === "fim") {
            if (ev.propostas.length) setPropostas(ev.propostas);
            setUso(`${ev.uso.modelo} · entrada ${int(ev.uso.tokensEntrada)} tok · saída ${int(ev.uso.tokensSaida)} tok`);
          } else setEventos((x) => [...x, ev]);
          setTimeout(() => fimRef.current?.scrollIntoView({ block: "nearest" }), 50);
        }
      }
    } catch (e) {
      setEventos((x) => [...x, { tipo: "erro", texto: String(e) }]);
    } finally { setRodando(false); }
  }

  const aprovadas = propostas.filter((p) => decisoes[p.id] === "aprovada");
  const valorAprovado = aprovadas.reduce((s, p) => s + p.valorLiquidoAno, 0);
  const totalPropostas = propostas.reduce((s, p) => s + p.valorLiquidoAno, 0);

  const lista = useMemo(() => {
    let l = plano.prefixos;
    if (filtro === "recomendadas") l = l.filter(recomendada);
    else if (filtro !== "todas") l = l.filter((x) => x.acao === filtro);
    return l;
  }, [plano, filtro]);

  const faixasHoje = plano.antes.porFaixa, faixasPot = plano.depois.porFaixa;
  const maxFaixa = Math.max(...FAIXAS.map((f) => faixasHoje[f.id].atrasos));

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      {/* cabeçalho */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Radar de Prazo</h1>
          <p className="text-sm text-slate-600">
            Agente que descobre onde a entrega atrasa, propõe a correção e mostra quanto ela vale por ano · Gocase e GoBeauté, 154 prefixos de CEP, 5 transportadoras
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">Meta de entrega no prazo</span>
            <select className="rounded-lg border border-slate-300 bg-white px-2 py-1.5" value={meta} onChange={(e) => setMeta(Number(e.target.value))}>
              {[0.92, 0.94, 0.95, 0.96].map((m) => <option key={m} value={m}>{pct(m)} por prefixo</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">Cliente desiste com prazo maior?</span>
            <select className="rounded-lg border border-slate-300 bg-white px-2 py-1.5" value={queda} onChange={(e) => setQueda(Number(e.target.value))}>
              <option value={0}>Não (0% por dia)</option>
              <option value={0.03}>Um pouco (−3% de conversão por dia)</option>
              <option value={0.065}>Como em SP (−6,5% por dia)</option>
            </select>
          </label>
        </div>
      </header>

      {/* placar */}
      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="No prazo hoje" valor={pct(plano.antes.noPrazo)} sub={`${int(plano.antes.atrasos)} atrasos e ${int(plano.antes.cancelamentos)} cancelamentos por ano`} />
        <Kpi titulo="Custo dos atrasos hoje" valor={brl(plano.antes.total)} sub={`por ano · ${brl(plano.antes.direto)} direto (atendimento + cancelamento) + recompra perdida`} />
        <Kpi destaque="azul" titulo={`Potencial · meta ${pct(meta)}`} valor={brl(pot.economiaTotal)} sub={`${pct(pot.noPrazoDepois)} no prazo · −${int(pot.atrasosEvitados)} atrasos · −${int(pot.cancelamentosEvitados)} cancelamentos/ano`} />
        <Kpi destaque="verde" titulo="Recomendado pelo agente" valor={brl(rec.valorLiquido)} sub={`líquido/ano · ${rec.prefixos} prefixos · ${pct(rec.noPrazoDepois)} no prazo · inclui ${brl(rec.conversao)} de vendas`} />
      </section>
      {pot.conversao < 0 && (
        <p className="mt-2 text-xs text-slate-500">
          Por que o recomendado é menor: para chegar à meta em todos os prefixos seria preciso prometer prazos maiores, o que custaria {brl(-pot.conversao)} em vendas
          (líquido do plano completo: {brl(pot.valorLiquido)}). O agente só recomenda o que tem saldo positivo.
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        {/* coluna esquerda: faixas + prefixos */}
        <div className="space-y-6 lg:col-span-3">
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="font-semibold">Atrasos por faixa, por ano</h2>
            <p className="text-xs text-slate-500">Hoje × com o plano completo na meta. Chance de cancelar e de contato: data/transportes/parametros.md</p>
            <table className="num mt-3 w-full text-sm">
              <thead className="text-left text-xs text-slate-500">
                <tr><th className="py-1">Dias úteis de atraso</th><th>Chance de cancelar</th><th className="w-2/5">Atrasos/ano</th><th className="text-right">Cancelamentos/ano</th></tr>
              </thead>
              <tbody>
                {FAIXAS.map((f) => {
                  const h = faixasHoje[f.id], p = faixasPot[f.id];
                  return (
                    <tr key={f.id} className="border-t border-slate-100">
                      <td className="py-2 font-medium">{f.id}</td>
                      <td>{pct(f.probCancel)}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="h-2 rounded bg-rose-300" style={{ width: `${(h.atrasos / maxFaixa) * 100}%` }} />
                          <span className="text-xs">{int(h.atrasos)}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <div className="h-2 rounded bg-sky-400" style={{ width: `${(p.atrasos / maxFaixa) * 100}%` }} />
                          <span className="text-xs">{int(p.atrasos)}</span>
                        </div>
                      </td>
                      <td className="text-right">{int(h.cancelamentos)} → <b>{int(p.cancelamentos)}</b></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-2 flex gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1"><span className="h-2 w-4 rounded bg-rose-300" /> hoje</span>
              <span className="flex items-center gap-1"><span className="h-2 w-4 rounded bg-sky-400" /> com o plano na meta</span>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">Ação por prefixo</h2>
              <div className="flex flex-wrap gap-1 text-xs">
                {(["recomendadas", "todas", "menos_margem", "mais_margem", "incidente", "rotear", "manter"] as const).map((f) => (
                  <button key={f} onClick={() => setFiltro(f)}
                    className={`rounded-full px-2.5 py-1 ${filtro === f ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
                    {f === "recomendadas" ? `Recomendadas (${plano.prefixos.filter(recomendada).length})` : f === "todas" ? "Todas (154)" : `${ROTULO_ACAO[f]} (${plano.contagem[f]})`}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-3 max-h-[520px] overflow-auto">
              <table className="num w-full text-sm">
                <thead className="sticky top-0 bg-white text-left text-xs text-slate-500">
                  <tr><th className="py-1">Prefixo</th><th>Ação</th><th>Prazo</th><th>No prazo</th><th className="text-right">Atrasos evitados</th><th className="text-right">Valor/ano</th></tr>
                </thead>
                <tbody>
                  {lista.map((x) => <LinhaPrefixo key={x.p3} x={x} aberto={aberto === x.p3} onClick={() => setAberto(aberto === x.p3 ? null : x.p3)} />)}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* coluna direita: agente */}
        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="font-semibold">Agente</h2>
                <p className="text-xs text-slate-500">Roda sozinho todo dia às 7h. Aqui você roda agora.</p>
              </div>
              <button disabled={rodando} onClick={() => rodarAgente()}
                className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                {rodando ? "Analisando…" : "▶ Rodar varredura"}
              </button>
            </div>
            <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (pergunta.trim()) rodarAgente(pergunta); }}>
              <input value={pergunta} onChange={(e) => setPergunta(e.target.value)} placeholder="Pergunte: e se colocar +1 dia em Marabá (685)?"
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
              <button disabled={rodando} className="rounded-lg border border-slate-300 px-3 text-sm disabled:opacity-50">Perguntar</button>
            </form>
            <ol className="mt-3 max-h-80 space-y-1.5 overflow-auto text-sm">
              {eventos.length === 0 && !rodando && <li className="text-slate-400">Nenhuma execução ainda.</li>}
              {eventos.map((e, i) => (
                <li key={i} className={e.tipo === "erro" ? "text-rose-700" : e.tipo === "final" ? "whitespace-pre-line rounded-lg bg-slate-50 p-3" : "text-slate-600"}>
                  {e.tipo === "ferramenta" ? <>🔧 {rotuloFerramenta(e)}</> : e.tipo === "pensamento" ? <>💭 {e.texto}</> : "texto" in e ? e.texto : null}
                </li>
              ))}
              {rodando && <li className="animate-pulse text-slate-400">…</li>}
              <div ref={fimRef} />
            </ol>
            {uso && <p className="mt-2 text-[11px] text-slate-400">IA: {uso} (o proxy não informa preço por chamada)</p>}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="font-semibold">Propostas para o gerente</h2>
              {propostas.length > 0 && <span className="num text-sm text-slate-600">total {brl(totalPropostas)}/ano</span>}
            </div>
            {propostas.length > 0 && (
              <div className="mt-2 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-900">
                Aprovado pelo gerente: <b className="num">{brl(valorAprovado)}/ano</b> ({aprovadas.length} de {propostas.length})
              </div>
            )}
            <div className="mt-3 space-y-3">
              {propostas.length === 0 && <p className="text-sm text-slate-400">Rode a varredura para o agente abrir as propostas.</p>}
              {propostas.map((p) => (
                <div key={p.id} className={`rounded-lg border p-3 text-sm ${decisoes[p.id] === "aprovada" ? "border-emerald-300 bg-emerald-50/50" : decisoes[p.id] === "recusada" ? "border-slate-200 opacity-50" : "border-slate-200"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{p.id} · {p.regiao} <span className="text-xs text-slate-500">({p.tipo})</span></div>
                      <div className="text-xs text-slate-500">Prefixos {p.prefixos.join(", ")}</div>
                    </div>
                    <div className="num text-right font-semibold text-emerald-700">{brl(p.valorLiquidoAno)}<span className="text-xs font-normal">/ano</span></div>
                  </div>
                  <div className="mt-1">{p.mudanca}</div>
                  <div className="num mt-1 text-xs text-slate-500">No prazo {pct(p.noPrazoAntes)} → {pct(p.noPrazoDepois)} · −{int(p.atrasosEvitadosAno)} atrasos · −{int(p.cancelamentosEvitadosAno)} cancelamentos/ano</div>
                  <div className="mt-1 text-xs italic text-slate-600">“{p.justificativa}”</div>
                  <div className="mt-2 flex gap-2">
                    {decisoes[p.id] ? (
                      <span className="text-xs font-medium">{decisoes[p.id] === "aprovada" ? "✔ Aprovada pelo gerente" : "✖ Recusada"}</span>
                    ) : (
                      <>
                        <button onClick={() => setDecisoes((d) => ({ ...d, [p.id]: "aprovada" }))} className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white">Aprovar</button>
                        <button onClick={() => setDecisoes((d) => ({ ...d, [p.id]: "recusada" }))} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs">Recusar</button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <footer className="mt-8 text-xs text-slate-500">
        Números: backtest — o agente aprende com envios até {dados.corteBacktest.split("-").reverse().join("/")} e é medido nos envios seguintes (que não viu), anualizado para {int(dados.enviosPorAno)} envios/ano.
        Envios vencidos e nunca entregues contam como atraso. Dados fictícios do GoHacks Talent 2026.
      </footer>
    </main>
  );
}

function LinhaPrefixo({ x, aberto, onClick }: { x: AcaoPrefixo; aberto: boolean; onClick: () => void }) {
  return (
    <>
      <tr onClick={onClick} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50">
        <td className="py-2"><b>{x.p3}</b> <span className="text-xs text-slate-500">{x.cidade}/{x.uf}</span></td>
        <td><span className={`rounded-full px-2 py-0.5 text-xs ${COR_ACAO[x.acao]}`}>{ROTULO_ACAO[x.acao]}</span></td>
        <td className="text-xs">{x.prazoAtual ?? "–"}{x.prazoNovo !== x.prazoAtual && <> → <b>{x.prazoNovo}</b></>} d</td>
        <td className="text-xs">{pct(x.noPrazoAntes)}{x.noPrazoDepois !== x.noPrazoAntes && <> → <b>{pct(x.noPrazoDepois)}</b></>}</td>
        <td className="text-right text-xs">{int(x.atrasosEvitados)}</td>
        <td className={`text-right font-medium ${x.valorLiquido > 0 ? "text-emerald-700" : x.valorLiquido < 0 ? "text-rose-700" : "text-slate-400"}`}>{brl(x.valorLiquido)}</td>
      </tr>
      {aberto && (
        <tr className="bg-slate-50">
          <td colSpan={6} className="px-2 py-3 text-xs text-slate-700">
            <div className="grid gap-1 sm:grid-cols-2">
              <div>Transportadora: <b>{x.transportadoraAtual ?? "–"}</b>{x.transportadoraNova && <> → <b>{x.transportadoraNova}</b></>}</div>
              <div>Margem de segurança: {x.margemAtual} → <b>{x.margemNova}</b> dia(s) · concorrentes prometem {x.concorrentes ?? "?"} dias</div>
              <div>Envios por ano (estimado): {int(x.enviosAno)}</div>
              <div>Cancelamentos evitados: {int(x.cancelamentosEvitados)}/ano</div>
              <div>Atrasos evitados: {brl(x.economiaTotal)} ({brl(x.economiaDireta)} direto + {brl(x.economiaRecompra)} recompra)</div>
              <div>Efeito na conversão: <b className={x.conversao >= 0 ? "text-emerald-700" : "text-rose-700"}>{brl(x.conversao)}</b>{x.freteExtra > 0 && <> · frete extra {brl(-x.freteExtra)}</>}</div>
            </div>
            {!recomendada(x) && ehAcaoReal(x) && <div className="mt-2 text-rose-700">Não recomendada: a perda de vendas ou o frete superam a economia com atrasos.</div>}
          </td>
        </tr>
      )}
    </>
  );
}
