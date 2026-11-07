"use client";

import { useMemo, useRef, useState } from "react";
import dadosJson from "@/data/radar.json";
import {
  type Dados, type Acao, type AcaoPrefixo, type Torre, type Roteamento, type Veredito, planoAcoes, resumir, recomendada, ehAcaoReal,
  FAIXAS, veredito, rotearNaoPostados,
} from "@/lib/radar";
import type { Proposta, Acionamento } from "@/lib/ferramentas";
import diaSeguinteJson from "@/data/dia_seguinte.json";

const dados = dadosJson as unknown as Dados & { torre: Torre };
const ds = diaSeguinteJson as { resumo: { respostas: Record<string, number>; novosParados: number }; alerta: { prefixo: string; cidade: string; transportadora: string; entreguesUltimos3Dias: number; noPrazoUltimos3Dias: number }; mensagemPortal: { transportadora: string; texto: string } };
type Chamado = { id: string; transportadora: string; cod: string; motivo: string };

// ---------- linguagem simples (para quem não é de logística) ----------
const SITUACAO: Record<Veredito, { rotulo: string; cor: string; explica: string }> = {
  saudavel: { rotulo: "Entrega bem", cor: "bg-emerald-50 text-emerald-700 border-emerald-200", explica: "Chega no dia prometido. Não mexer." },
  prazo_sobrando: { rotulo: "Promete dias demais", cor: "bg-sky-50 text-sky-700 border-sky-200", explica: "Entrega rápido, mas o site promete um prazo longo e o cliente compra no concorrente." },
  prazo_curto: { rotulo: "Promete dias de menos", cor: "bg-amber-50 text-amber-700 border-amber-200", explica: "A transportadora leva mais do que o site promete: o pedido chega atrasado." },
  transportadora_falhando: { rotulo: "Transportadora falha", cor: "bg-rose-50 text-rose-700 border-rose-200", explica: "Nem prometendo mais dias resolve: é preciso cobrar a transportadora." },
  transportadora_melhor: { rotulo: "Outra transportadora é melhor", cor: "bg-violet-50 text-violet-700 border-violet-200", explica: "Outra transportadora que atende a região entrega mais no prazo." },
  monitorar: { rotulo: "Atrasa, mas mexer não compensa", cor: "bg-orange-50 text-orange-700 border-orange-200", explica: "Prometer mais dias faria perder mais vendas do que economiza. O agente acompanha." },
  poucos_dados: { rotulo: "Poucos pedidos", cor: "bg-slate-50 text-slate-500 border-slate-200", explica: "Poucos pedidos para decidir com segurança." },
};
const ACAO: Record<Acao, { rotulo: string; cor: string }> = {
  menos_margem: { rotulo: "Prometer menos dias", cor: "bg-emerald-100 text-emerald-800" },
  mais_margem: { rotulo: "Prometer mais dias", cor: "bg-amber-100 text-amber-800" },
  rotear: { rotulo: "Trocar transportadora", cor: "bg-sky-100 text-sky-800" },
  incidente: { rotulo: "Cobrar a transportadora", cor: "bg-rose-100 text-rose-800" },
  manter: { rotulo: "Manter", cor: "bg-slate-100 text-slate-600" },
  sem_dados: { rotulo: "Aguardar dados", cor: "bg-slate-100 text-slate-400" },
};
const ROTULO_DESTINO: Record<string, string> = { gerente_logistica: "Gerente de logística", financeiro: "Financeiro", atendimento_cx: "Atendimento", gerente_contas_transportadora: "Gerente de contas da transportadora", seguranca: "Segurança" };

// ---------- formatação ----------
const int = (x: number) => Math.round(x).toLocaleString("pt-BR");
const pct = (x: number) => (x * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
function brl(x: number) {
  const s = x < 0 ? "−" : "", a = Math.abs(x);
  if (a >= 1e6) return `${s}R$ ${(a / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
  if (a >= 1e3) return `${s}R$ ${Math.round(a / 1e3).toLocaleString("pt-BR")} mil`;
  return `${s}R$ ${Math.round(a)}`;
}

type Evento =
  | { tipo: "ferramenta"; nome: string; args: Record<string, unknown>; resultado: unknown }
  | { tipo: "pensamento" | "final" | "erro"; texto: string }
  | { tipo: "fim"; propostas: Proposta[]; acionamentos?: Acionamento[]; chamados?: Chamado[]; roteamento?: Roteamento[]; uso: { modelo: string; tokensEntrada: number; tokensSaida: number } };

function passoDoAgente(e: Extract<Evento, { tipo: "ferramenta" }>) {
  const a = e.args;
  switch (e.nome) {
    case "resumo_geral": return "Olhou o placar das 154 regiões";
    case "listar_prefixos": return "Separou as regiões por tipo de problema";
    case "diagnosticar_prefixo": return `Investigou a região de CEP ${a.prefixo}`;
    case "simular_margem": return `Simulou prometer ${a.margem} dia(s) extra(s) na região ${a.prefixo}`;
    case "novidades_do_dia": return "Leu o que aconteceu durante a noite";
    case "acionar_pessoa": return `Chamou: ${ROTULO_DESTINO[String(a.destino)] ?? a.destino}`;
    case "torre_de_controle": return "Conferiu os pedidos de hoje";
    case "abrir_chamados_portal": { const r = e.resultado as { abertos_agora?: number }; return `Cobrou a transportadora em ${r?.abertos_agora ?? 0} pedidos parados`; }
    case "rotear_envios_novos": { const r = e.resultado as { roteados?: number }; return `Mandou ${r?.roteados ?? 0} pedidos novos por uma transportadora melhor`; }
    case "propor_mudanca": return `Preparou uma decisão para o gerente: ${a.regiao ?? ""}`;
    default: return e.nome;
  }
}

type Aba = "regioes" | "pedidos" | "calculo";

export default function Painel() {
  const [meta, setMeta] = useState(0.95);
  const [queda, setQueda] = useState(1);
  const [aba, setAba] = useState<Aba>("regioes");
  const [soAcao, setSoAcao] = useState(true);
  const [aberto, setAberto] = useState<string | null>(null);

  const plano = useMemo(() => planoAcoes(dados, meta, queda), [meta, queda]);
  const pot = useMemo(() => resumir(plano, ehAcaoReal), [plano]);
  const rec = useMemo(() => resumir(plano, recomendada), [plano]);
  const tk = plano.tiktok;
  const valorTotal = rec.valorLiquido + (tk?.valorAno ?? 0);

  // ---------- agente ----------
  const [rodando, setRodando] = useState(false);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [propostas, setPropostas] = useState<Proposta[]>([]);
  const [decisoes, setDecisoes] = useState<Record<string, "aprovada" | "recusada">>({});
  const [uso, setUso] = useState<string>("");
  const [chamados, setChamados] = useState<Chamado[]>([]);
  const [roteados, setRoteados] = useState<Roteamento[] | null>(null);
  const [dia, setDia] = useState<1 | 2>(1);
  const [ontem, setOntem] = useState<Proposta[]>([]);
  const [acionamentos, setAcionamentos] = useState<Acionamento[]>([]);
  const [pergunta, setPergunta] = useState("");
  const fimRef = useRef<HTMLDivElement>(null);

  function limpar() { setPropostas([]); setDecisoes({}); setChamados([]); setRoteados(null); setEventos([]); setAcionamentos([]); setUso(""); }
  function irParaDiaSeguinte() { setOntem(propostas.filter((p) => decisoes[p.id] === "aprovada")); setDia(2); limpar(); }
  function voltarParaHoje() { setDia(1); setOntem([]); limpar(); }

  async function rodarAgente(textoPergunta?: string) {
    setRodando(true); setEventos([]); setUso("");
    if (!textoPergunta) { setPropostas([]); setDecisoes({}); setChamados([]); setRoteados(null); setAcionamentos([]); }
    try {
      const r = await fetch("/api/agente", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meta, sensibilidade: queda, pergunta: textoPergunta, dia, aprovadasOntem: ontem.map((p) => `${p.id} ${p.regiao}: ${p.mudanca}`) }),
      });
      if (!r.ok || !r.body) { const j = await r.json().catch(() => ({})); throw new Error(j.erro ?? `HTTP ${r.status}`); }
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
            if (ev.chamados?.length) setChamados(ev.chamados);
            if (ev.roteamento?.length) setRoteados(ev.roteamento);
            if (ev.acionamentos?.length) setAcionamentos(ev.acionamentos);
            setUso(`${ev.uso.modelo} · ${int(ev.uso.tokensEntrada + ev.uso.tokensSaida)} tokens`);
          } else setEventos((x) => [...x, ev]);
          setTimeout(() => fimRef.current?.scrollIntoView({ block: "nearest" }), 50);
        }
      }
    } catch (e) {
      setEventos((x) => [...x, { tipo: "erro", texto: String(e) }]);
    } finally { setRodando(false); }
  }

  const aprovadas = propostas.filter((p) => decisoes[p.id] === "aprovada");
  const pacoteTiktok = propostas.filter((p) => p.prefixosPacoteTiktok > 0);
  const tiktokAprovado = !!tk?.valorAno && pacoteTiktok.length > 0 && pacoteTiktok.every((p) => decisoes[p.id] === "aprovada");
  const valorAprovado = aprovadas.reduce((s, p) => s + p.valorLiquidoAno, 0) + (tiktokAprovado ? tk!.valorAno : 0);
  const totalPropostas = propostas.reduce((s, p) => s + p.valorLiquidoAno, 0) + (pacoteTiktok.length ? tk?.valorAno ?? 0 : 0);

  const situacoes = useMemo(() => plano.prefixos.reduce((c, x) => { const v = veredito(x); c[v] = (c[v] ?? 0) + 1; return c; }, {} as Record<Veredito, number>), [plano]);
  const lista = useMemo(() => (soAcao ? plano.prefixos.filter(recomendada) : plano.prefixos), [plano, soAcao]);
  const torre = dados.torre;
  const previaRota = useMemo(() => rotearNaoPostados(dados), []);
  const multaTotal = torre.multaTransportadoras.reduce((s, m) => s + m.multaDevidaAno, 0);
  const comChamado = new Set(chamados.map((c) => c.id));
  const atrasadosDe100 = Math.round((1 - plano.antes.noPrazo) * 100);

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Radar de Prazo</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">
          Toda compra na Gocase vem com uma data prometida de entrega. Hoje <b>{atrasadosDe100} de cada 100 pedidos chegam atrasados</b>, e parte desses clientes cancela ou não volta.
          Um agente de IA olha todo dia as 154 regiões do país e cada pedido em trânsito, resolve sozinho o que é rotina e leva ao gerente só as decisões que dão lucro.
        </p>
      </header>

      {/* a história em 3 números */}
      <section className="mt-5 grid items-stretch gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Hoje</div>
          <div className="num mt-1 text-4xl font-bold">{pct(plano.antes.noPrazo)}</div>
          <div className="text-sm text-slate-600">dos pedidos chegam no dia prometido</div>
          <div className="num mt-3 text-xs text-slate-500">{int(plano.antes.atrasos)} atrasos e {int(plano.antes.cancelamentos)} cancelamentos por ano · custo de {brl(plano.antes.total)}/ano</div>
        </div>
        <div className="hidden items-center text-3xl text-slate-300 lg:flex">→</div>
        <div className="rounded-2xl border border-sky-200 bg-sky-50 p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-sky-700">Com o agente</div>
          <div className="num mt-1 text-4xl font-bold text-sky-900">{pct(rec.noPrazoDepois)}</div>
          <div className="text-sm text-sky-900">dos pedidos no prazo{tk?.destravado ? `, acima da régua de ${pct(tk.regua)} do TikTok Shop` : ""}</div>
          <div className="num mt-3 text-xs text-sky-800">−{int(rec.atrasosEvitados)} atrasos e −{int(rec.cancelamentosEvitados)} cancelamentos por ano · ações em {rec.prefixos} regiões</div>
        </div>
        <div className="hidden items-center text-3xl text-slate-300 lg:flex">=</div>
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-5">
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Quanto vale</div>
          <div className="num mt-1 text-4xl font-bold text-emerald-900">{brl(valorTotal)}</div>
          <div className="text-sm text-emerald-900">por ano, já descontado o que se perde</div>
          {tk?.valorAno ? <div className="num mt-3 text-xs text-emerald-800">inclui {brl(tk.valorAno)} de vendas recuperadas no TikTok Shop (+{int(tk.pedidosRecuperadosAno)} pedidos/ano)</div> : null}
        </div>
      </section>
      {tk && (
        <p className="mt-2 text-xs text-slate-500">
          Por que 92%: no TikTok Shop ({pct(tk.fatia)} das vendas), se a loja entrega menos de {pct(tk.regua)} no prazo, a plataforma mostra menos os produtos e as vendas caem {pct(tk.corte)}.
          Regra informada pela banca. Chegar a 95% em todas as regiões é possível ({pct(pot.noPrazoDepois)}), mas obrigaria a prometer prazos maiores e perder {brl(-pot.conversao)} em vendas; o agente não recomenda.
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        {/* ---------- esquerda: abas ---------- */}
        <div className="lg:col-span-3">
          <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1 text-sm">
            {([["regioes", "As 154 regiões"], ["pedidos", "Pedidos de hoje"], ["calculo", "Como calculamos"]] as [Aba, string][]).map(([k, t]) => (
              <button key={k} onClick={() => setAba(k)} className={`flex-1 rounded-lg px-3 py-2 ${aba === k ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}>{t}</button>
            ))}
          </div>

          {aba === "regioes" && (
            <section className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="font-semibold">Situação de cada região (CEP)</h2>
              <p className="text-xs text-slate-500">O agente analisa todas. Passe o mouse para ver o que cada situação significa.</p>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(Object.keys(SITUACAO) as Veredito[]).map((v) => (
                  <div key={v} title={SITUACAO[v].explica} className={`cursor-help rounded-lg border px-3 py-2 ${SITUACAO[v].cor}`}>
                    <div className="num text-2xl font-semibold">{situacoes[v] ?? 0}</div>
                    <div className="text-xs leading-tight">{SITUACAO[v].rotulo}</div>
                  </div>
                ))}
              </div>

              <div className="mt-5 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{soAcao ? `Onde o agente vai agir (${lista.length})` : "Todas as regiões (154)"}</h3>
                <button onClick={() => setSoAcao(!soAcao)} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700 hover:bg-slate-200">
                  {soAcao ? "Ver todas" : "Só onde o agente age"}
                </button>
              </div>
              <div className="mt-2 max-h-[460px] overflow-auto">
                <table className="num w-full text-sm">
                  <thead className="sticky top-0 bg-white text-left text-xs text-slate-500">
                    <tr><th className="py-1">Região</th><th>O que o agente faz</th><th>No prazo</th><th className="text-right">Valor/ano</th></tr>
                  </thead>
                  <tbody>
                    {lista.map((x) => <LinhaRegiao key={x.p3} x={x} aberto={aberto === x.p3} onClick={() => setAberto(aberto === x.p3 ? null : x.p3)} />)}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-slate-400">Clique numa região para ver o detalhe. Valor negativo em vermelho: a ação sozinha dá prejuízo, mas entra no pacote que leva a loja acima de 92% no TikTok Shop.</p>
            </section>
          )}

          {aba === "pedidos" && (
            <section className="mt-3 rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="font-semibold">Pedidos de hoje</h2>
              <p className="text-xs text-slate-500">Aqui o agente age sozinho, sem esperar o gerente. (Listas de uma amostra de 1 em cada 6 pedidos.)</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="text-xs text-slate-500">Pedidos parados há 3+ dias</div>
                  <div className="num text-2xl font-semibold">{int(torre.emRisco.length)}</div>
                  <div className="mt-1 text-xs font-medium text-emerald-700">{chamados.length ? `Agente cobrou a transportadora em ${chamados.length}` : "O agente cobra a transportadora (até 80/dia)"}</div>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="text-xs text-slate-500">Pedidos novos a despachar</div>
                  <div className="num text-2xl font-semibold">{int(torre.naoPostados.length)}</div>
                  <div className="mt-1 text-xs font-medium text-emerald-700">{roteados ? `Agente trocou a transportadora de ${roteados.length}` : `${previaRota.roteados.length} podem ir por transportadora melhor`}</div>
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <div className="text-xs text-slate-500">Multa de atraso a cobrar</div>
                  <div className="num text-2xl font-semibold">{brl(multaTotal)}<span className="text-xs font-normal">/ano</span></div>
                  <div className="mt-1 text-xs text-slate-500">previstas nos contratos e não cobradas</div>
                </div>
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div>
                  <div className="text-xs font-medium text-slate-600">Mais urgentes</div>
                  <ul className="num mt-1 space-y-1 text-xs">
                    {torre.emRisco.slice(0, 6).map((e) => (
                      <li key={e.id} className="flex justify-between gap-2 border-t border-slate-100 pt-1">
                        <span>CEP <b>{e.p3}</b> · {e.t} · parado há {e.paradoDiasUteis} dias</span>
                        <span className={comChamado.has(e.id) ? "text-emerald-700" : e.vencido ? "text-rose-700" : "text-amber-700"}>{comChamado.has(e.id) ? "cobrado ✔" : e.vencido ? "já atrasado" : `vence ${e.prometida.slice(8, 10)}/${e.prometida.slice(5, 7)}`}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="text-xs font-medium text-slate-600">Transportadoras: no prazo × contrato (95%)</div>
                  <table className="num mt-1 w-full text-xs">
                    <tbody>
                      {torre.multaTransportadoras.map((m) => (
                        <tr key={m.transportadora} className="border-t border-slate-100">
                          <td className="py-1">{m.transportadora}</td>
                          <td className={m.noPrazoEntregues < m.metaContrato ? "text-rose-700" : "text-emerald-700"}>{pct(m.noPrazoEntregues)}</td>
                          <td className="text-right">multa {brl(m.multaDevidaAno)}/ano</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {aba === "calculo" && <ComoCalculamos plano={plano} meta={meta} setMeta={setMeta} queda={queda} setQueda={setQueda} />}
        </div>

        {/* ---------- direita: agente e gerente ---------- */}
        <div className="space-y-4 lg:col-span-2">
          <div className="flex rounded-xl border border-slate-200 bg-white p-1 text-sm">
            <button onClick={voltarParaHoje} className={`flex-1 rounded-lg px-3 py-2 ${dia === 1 ? "bg-slate-900 text-white" : "text-slate-600"}`}>Hoje, 02/11</button>
            <button onClick={irParaDiaSeguinte} disabled={rodando} className={`flex-1 rounded-lg px-3 py-2 ${dia === 2 ? "bg-fuchsia-700 text-white" : "text-slate-600"}`}>Amanhã, 03/11 (simulado)</button>
          </div>

          {dia === 2 && (
            <section className="rounded-xl border border-fuchsia-300 bg-fuchsia-50/40 p-4 text-sm">
              <h2 className="font-semibold">Bom dia, gerente · 03/11, 7h</h2>
              <p className="text-[11px] text-fuchsia-800">Dia simulado para a demonstração; não entra nos números.</p>
              <div className="mt-2 text-xs font-medium text-slate-600">Em vigor desde ontem</div>
              {ontem.length ? <ul className="mt-1 list-disc pl-5 text-xs">{ontem.map((p) => <li key={p.id}>{p.regiao}: {p.mudanca}</li>)}</ul>
                : <p className="mt-1 text-xs text-slate-500">Nada aprovado ontem. Para a demo: em “Hoje”, rode o agente e aprove as decisões antes de avançar.</p>}
              <div className="mt-3 text-xs font-medium text-slate-600">Durante a noite</div>
              <ul className="mt-1 space-y-0.5 text-xs">
                <li>📨 Transportadoras responderam: {ds.resumo.respostas.nova_previsao ?? 0} com nova data, {ds.resumo.respostas.entregue ?? 0} entregues, {ds.resumo.respostas.sem_resposta ?? 0} sem resposta, {ds.resumo.respostas.extraviado ?? 0} perdidos</li>
                <li>⏸ {ds.resumo.novosParados} pedidos pararam</li>
                <li>📉 {ds.alerta.cidade}: só {ds.alerta.noPrazoUltimos3Dias} de {ds.alerta.entreguesUltimos3Dias} no prazo em 3 dias ({ds.alerta.transportadora})</li>
                <li>⚠️ Mensagem suspeita no portal da {ds.mensagemPortal.transportadora}: “{ds.mensagemPortal.texto}”</li>
              </ul>
              {acionamentos.length > 0 && (
                <>
                  <div className="mt-3 text-xs font-medium text-slate-600">O agente chamou</div>
                  <ul className="mt-1 space-y-1 text-xs">
                    {acionamentos.map((a, i) => (
                      <li key={i} className="rounded border border-slate-200 bg-white p-2">
                        <b>{ROTULO_DESTINO[a.destino] ?? a.destino}</b> <span className={a.urgencia === "alta" ? "text-rose-700" : "text-slate-500"}>· urgência {a.urgencia}</span><br />{a.motivo}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="font-semibold">Agente de IA</h2>
                <p className="text-xs text-slate-500">{dia === 2 ? "Rotina da manhã: trata o que mudou desde ontem." : "Roda sozinho todo dia às 7h. Aqui você vê ao vivo."}</p>
              </div>
              <button disabled={rodando} onClick={() => rodarAgente()} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                {rodando ? "Trabalhando…" : "▶ Rodar agente"}
              </button>
            </div>
            <ol className="mt-3 max-h-72 space-y-1.5 overflow-auto text-sm">
              {eventos.length === 0 && !rodando && <li className="text-slate-400">Clique em “Rodar agente” para ver o que ele faz, passo a passo (~1 min).</li>}
              {eventos.map((e, i) => (
                <li key={i} className={e.tipo === "erro" ? "text-rose-700" : e.tipo === "final" ? "whitespace-pre-line rounded-lg bg-slate-50 p-3 text-slate-800" : "text-slate-600"}>
                  {e.tipo === "ferramenta" ? <>✓ {passoDoAgente(e)}</> : e.tipo === "pensamento" ? <span className="text-slate-400">{e.texto}</span> : "texto" in e ? e.texto : null}
                </li>
              ))}
              {rodando && <li className="animate-pulse text-slate-400">…</li>}
              <div ref={fimRef} />
            </ol>
            <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (pergunta.trim()) rodarAgente(pergunta); }}>
              <input value={pergunta} onChange={(e) => setPergunta(e.target.value)} placeholder="Pergunte algo: e se prometer +1 dia em Marabá?"
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
              <button disabled={rodando} className="rounded-lg border border-slate-300 px-3 text-sm disabled:opacity-50">Perguntar</button>
            </form>
            {uso && <p className="mt-2 text-[11px] text-slate-400">IA: {uso}</p>}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="font-semibold">Decisões para o gerente</h2>
              {propostas.length > 0 && <span className="num text-sm text-slate-600">{brl(totalPropostas)}/ano</span>}
            </div>
            {propostas.length > 0 && (
              <div className="mt-2 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-900">
                Aprovado: <b className="num">{brl(valorAprovado)}/ano</b> ({aprovadas.length} de {propostas.length})
                {pacoteTiktok.length > 0 && <span className="block text-xs">{tiktokAprovado ? <>TikTok Shop destravado: +{brl(tk!.valorAno)}/ano</> : <>Aprove as {pacoteTiktok.length} decisões marcadas “TikTok” para destravar {brl(tk?.valorAno ?? 0)}/ano</>}</span>}
              </div>
            )}
            <div className="mt-3 space-y-2">
              {propostas.length === 0 && <p className="text-sm text-slate-400">{dia === 2 && eventos.some((e) => e.tipo === "final") ? "Nada novo para decidir hoje: o que foi aprovado ontem segue valendo." : "O agente traz aqui as decisões que precisam de aprovação."}</p>}
              {propostas.map((p) => (
                <div key={p.id} className={`rounded-lg border p-3 text-sm ${decisoes[p.id] === "aprovada" ? "border-emerald-300 bg-emerald-50/50" : decisoes[p.id] === "recusada" ? "border-slate-200 opacity-50" : "border-slate-200"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{p.regiao}</div>
                      <div className="text-xs text-slate-600">{p.mudanca}</div>
                    </div>
                    <div className={`num shrink-0 text-right font-semibold ${p.valorLiquidoAno >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{brl(p.valorLiquidoAno)}<span className="text-xs font-normal">/ano</span></div>
                  </div>
                  <div className="num mt-1 text-xs text-slate-500">
                    {p.prefixos.length} região(ões) · no prazo {pct(p.noPrazoAntes)} → {pct(p.noPrazoDepois)}
                    {p.prefixosPacoteTiktok > 0 && <span className="ml-1 rounded bg-fuchsia-100 px-1.5 py-0.5 text-[11px] text-fuchsia-800">TikTok</span>}
                  </div>
                  <details className="mt-1 text-xs text-slate-600">
                    <summary className="cursor-pointer text-slate-500">Por quê?</summary>
                    <p className="mt-1 italic">“{p.justificativa}”</p>
                    <p className="mt-1 text-slate-500">Regiões (CEP): {p.prefixos.join(", ")}</p>
                  </details>
                  <div className="mt-2 flex gap-2">
                    {decisoes[p.id] ? (
                      <span className="text-xs font-medium">{decisoes[p.id] === "aprovada" ? "✔ Aprovada" : "✖ Recusada"}</span>
                    ) : (
                      <>
                        <button onClick={() => setDecisoes((d) => ({ ...d, [p.id]: "aprovada" }))} className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white">Aprovar</button>
                        <button onClick={() => setDecisoes((d) => ({ ...d, [p.id]: "recusada" }))} className="rounded-md border border-slate-300 px-3 py-1 text-xs">Recusar</button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <footer className="mt-8 text-xs text-slate-400">Dados fictícios do GoHacks Talent 2026 · Gocase e GoBeauté · detalhes na aba “Como calculamos”.</footer>
    </main>
  );
}

function LinhaRegiao({ x, aberto, onClick }: { x: AcaoPrefixo; aberto: boolean; onClick: () => void }) {
  const v = veredito(x), dias = x.margemNova - x.margemAtual;
  const oQueFaz = x.acao === "mais_margem" ? `Prometer +${dias} dia${dias > 1 ? "s" : ""}`
    : x.acao === "menos_margem" ? `Prometer ${Math.abs(dias)} dia${Math.abs(dias) > 1 ? "s" : ""} a menos`
    : x.acao === "rotear" ? `Trocar para ${x.transportadoraNova}`
    : x.acao === "incidente" ? `Cobrar a ${x.transportadoraAtual}` : ACAO[x.acao].rotulo;
  const age = recomendada(x);
  return (
    <>
      <tr onClick={onClick} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50">
        <td className="py-2">
          <div><b>{x.cidade}</b> <span className="text-xs text-slate-500">{x.uf} · CEP {x.p3}</span></div>
          <span className={`mt-0.5 inline-block rounded border px-1.5 text-[11px] ${SITUACAO[v].cor}`}>{SITUACAO[v].rotulo}</span>
        </td>
        <td>{age ? <span className={`rounded-full px-2 py-0.5 text-xs ${ACAO[x.acao].cor}`}>{oQueFaz}</span> : <span className="text-xs text-slate-400">—</span>}</td>
        <td className="text-xs">{pct(x.noPrazoAntes)}{age && x.noPrazoDepois !== x.noPrazoAntes && <> → <b>{pct(x.noPrazoDepois)}</b></>}</td>
        <td className={`text-right font-medium ${!age ? "text-slate-300" : x.valorLiquido > 0 ? "text-emerald-700" : "text-rose-700"}`}>{age ? brl(x.valorLiquido) : "—"}</td>
      </tr>
      {aberto && (
        <tr className="bg-slate-50">
          <td colSpan={4} className="px-2 py-3 text-xs text-slate-700">
            <p className="mb-2">{SITUACAO[v].explica}</p>
            <div className="grid gap-1 sm:grid-cols-2">
              <div>Transportadora: <b>{x.transportadoraAtual ?? "–"}</b>{x.transportadoraNova && <> → <b>{x.transportadoraNova}</b></>}</div>
              <div>Prazo prometido no site: {x.prazoAtual ?? "–"} dias{x.prazoNovo !== x.prazoAtual && <> → <b>{x.prazoNovo}</b></>} · concorrentes: {x.concorrentes ?? "?"} dias</div>
              <div>Pedidos por ano: {int(x.enviosAno)}</div>
              <div>Atrasos evitados: {int(x.atrasosEvitados)}/ano · cancelamentos evitados: {int(x.cancelamentosEvitados)}/ano</div>
              <div>Economia com atrasos: {brl(x.economiaTotal)}/ano</div>
              <div>Vendas no site: <b className={x.conversao >= 0 ? "text-emerald-700" : "text-rose-700"}>{brl(x.conversao)}</b>/ano{x.freteExtra > 0 && <> · frete a mais {brl(-x.freteExtra)}</>}</div>
            </div>
            {x.estimadoPor && <div className="mt-2 text-amber-700">Poucos pedidos nesta região: a decisão usa o histórico de regiões parecidas ({x.estimadoPor}).</div>}
            {x.peloTiktok && <div className="mt-2 text-fuchsia-700">Sozinha dá prejuízo, mas entra no pacote que leva a loja acima de 92% e destrava o TikTok Shop.</div>}
            {!age && ehAcaoReal(x) && <div className="mt-2 text-rose-700">O agente não age aqui: perderia mais vendas do que economizaria.</div>}
          </td>
        </tr>
      )}
    </>
  );
}

function ComoCalculamos({ plano, meta, setMeta, queda, setQueda }: { plano: ReturnType<typeof planoAcoes>; meta: number; setMeta: (n: number) => void; queda: number; setQueda: (n: number) => void }) {
  const fh = plano.antes.porFaixa, fp = plano.depois.porFaixa;
  const max = Math.max(...FAIXAS.map((f) => fh[f.id].atrasos));
  return (
    <section className="mt-3 space-y-5 rounded-xl border border-slate-200 bg-white p-4 text-sm">
      <div>
        <h2 className="font-semibold">Quanto custa cada atraso</h2>
        <p className="text-xs text-slate-500">Quanto mais dias de atraso, mais o cliente reclama e cancela (regras do desafio, parametros.md). Barras: hoje × com todas as ações.</p>
        <table className="num mt-2 w-full text-sm">
          <thead className="text-left text-xs text-slate-500"><tr><th className="py-1">Atraso</th><th>Chance de cancelar</th><th className="w-2/5">Atrasos/ano</th><th className="text-right">Cancelamentos/ano</th></tr></thead>
          <tbody>
            {FAIXAS.map((f) => (
              <tr key={f.id} className="border-t border-slate-100">
                <td className="py-2">{f.id} dias</td>
                <td>{pct(f.probCancel)}</td>
                <td>
                  <div className="flex items-center gap-2"><div className="h-2 rounded bg-rose-300" style={{ width: `${(fh[f.id].atrasos / max) * 100}%` }} /><span className="text-xs">{int(fh[f.id].atrasos)}</span></div>
                  <div className="mt-1 flex items-center gap-2"><div className="h-2 rounded bg-sky-400" style={{ width: `${(fp[f.id].atrasos / max) * 100}%` }} /><span className="text-xs">{int(fp[f.id].atrasos)}</span></div>
                </td>
                <td className="text-right">{int(fh[f.id].cancelamentos)} → <b>{int(fp[f.id].cancelamentos)}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <h2 className="font-semibold">De onde vêm os números</h2>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-slate-600">
          <li>A data de entrega real vem dos sites das 5 transportadoras, cada um num formato; o sistema junta tudo. Pedido que nunca chegou conta como atraso.</li>
          <li>Teste honesto: o agente aprende com os pedidos até {dados.corteBacktest.split("-").reverse().join("/")} e é medido nos pedidos seguintes, que ele não viu. Anualizado para {int(dados.enviosPorAno)} pedidos/ano.</li>
          <li>Venda perdida por prometer mais dias: medida em 70 mil registros do checkout. Quando ficamos atrás da concorrência em {Object.entries(dados.curvaConversao).filter(([g]) => Number(g) >= 1 && Number(g) <= 3).map(([g, f]) => `${g} dia(s), vendemos ${Math.round((1 - f) * 100)}% menos`).join("; ")}. Confere com o caso real de São Paulo (−26%).</li>
          <li>TikTok Shop: regra informada pela banca (20% das vendas; corte de 15% abaixo de 92% no prazo). Não está na base original.</li>
          <li>O “amanhã, 03/11” é simulado só para mostrar a rotina do gerente.</li>
        </ul>
      </div>
      <div>
        <h2 className="font-semibold">Premissas (para testar cenários)</h2>
        <div className="mt-2 flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">Meta de entrega no prazo por região</span>
            <select className="rounded-lg border border-slate-300 bg-white px-2 py-1.5" value={meta} onChange={(e) => setMeta(Number(e.target.value))}>
              {[0.92, 0.94, 0.95, 0.96].map((m) => <option key={m} value={m}>{pct(m)}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">O cliente desiste com prazo maior?</span>
            <select className="rounded-lg border border-slate-300 bg-white px-2 py-1.5" value={queda} onChange={(e) => setQueda(Number(e.target.value))}>
              <option value={1}>Sim, como medido no checkout</option>
              <option value={0.5}>Metade do medido</option>
              <option value={0}>Ignorar</option>
            </select>
          </label>
        </div>
      </div>
    </section>
  );
}
