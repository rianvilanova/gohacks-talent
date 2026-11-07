"use client";

import { useMemo, useRef, useState } from "react";
import dadosJson from "@/data/radar.json";
import {
  type Dados, type Acao, type AcaoPrefixo, type Torre, type Roteamento, type Veredito, planoAcoes, resumir, recomendada, ehAcaoReal,
  FAIXAS, ROTULO_ACAO, ROTULO_VEREDITO, veredito, rotearNaoPostados,
} from "@/lib/radar";
import type { Proposta, Acionamento } from "@/lib/ferramentas";
import diaSeguinteJson from "@/data/dia_seguinte.json";

const dados = dadosJson as unknown as Dados & { torre: Torre };
const COR_VEREDITO: Record<Veredito, string> = {
  saudavel: "bg-emerald-50 text-emerald-700 border-emerald-200", prazo_sobrando: "bg-sky-50 text-sky-700 border-sky-200",
  prazo_curto: "bg-amber-50 text-amber-700 border-amber-200", transportadora_falhando: "bg-rose-50 text-rose-700 border-rose-200",
  transportadora_melhor: "bg-violet-50 text-violet-700 border-violet-200", poucos_dados: "bg-slate-50 text-slate-500 border-slate-200",
  monitorar: "bg-orange-50 text-orange-700 border-orange-200",
};
const ds = diaSeguinteJson as { resumo: { respostas: Record<string, number>; novosParados: number }; alerta: { prefixo: string; cidade: string; transportadora: string; entreguesUltimos3Dias: number; noPrazoUltimos3Dias: number }; mensagemPortal: { transportadora: string; texto: string } };
const ROTULO_DESTINO: Record<string, string> = { gerente_logistica: "Gerente de logística", financeiro: "Financeiro", atendimento_cx: "Atendimento (CX)", gerente_contas_transportadora: "Gerente de contas da transportadora", seguranca: "Segurança" };
type Chamado = { id: string; transportadora: string; cod: string; motivo: string };

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
  | { tipo: "fim"; propostas: Proposta[]; acionamentos?: Acionamento[]; chamados?: Chamado[]; roteamento?: Roteamento[]; uso: { modelo: string; tokensEntrada: number; tokensSaida: number } };

function rotuloFerramenta(e: Extract<Evento, { tipo: "ferramenta" }>) {
  const a = e.args;
  switch (e.nome) {
    case "resumo_geral": return "Leu o placar geral dos 154 prefixos";
    case "listar_prefixos": return `Listou prefixos por ${a.ordem === "pior_prazo" ? "pior prazo" : a.ordem === "prejuizo" ? "ações que dariam prejuízo" : "valor"}${a.acao ? ` (${ROTULO_ACAO[a.acao as Acao]})` : ""}`;
    case "diagnosticar_prefixo": return `Diagnosticou o prefixo ${a.prefixo}`;
    case "simular_margem": return `Simulou margem de ${a.margem} dia(s) no prefixo ${a.prefixo}`;
    case "novidades_do_dia": return "Leu as novidades desde ontem: respostas dos chamados, envios parados, alertas e mensagens";
    case "acionar_pessoa": return `Acionou ${ROTULO_DESTINO[String(a.destino)] ?? a.destino} (urgência ${a.urgencia})`;
    case "torre_de_controle": return "Abriu a torre de controle: envios parados, envios novos e multa";
    case "abrir_chamados_portal": { const r = e.resultado as { abertos_agora?: number }; return `Abriu ${r?.abertos_agora ?? 0} chamados nos portais das transportadoras`; }
    case "rotear_envios_novos": { const r = e.resultado as { roteados?: number; envios_analisados?: number }; return `Roteou ${r?.roteados ?? 0} de ${r?.envios_analisados ?? 0} envios novos`; }
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
  const [queda, setQueda] = useState(1); // sensibilidade à curva de conversão medida
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
  const [chamados, setChamados] = useState<Chamado[]>([]);
  const [roteados, setRoteados] = useState<Roteamento[] | null>(null);
  const [dia, setDia] = useState<1 | 2>(1);
  const [ontem, setOntem] = useState<Proposta[]>([]); // propostas aprovadas no dia 02/11
  const [acionamentos, setAcionamentos] = useState<Acionamento[]>([]);

  function irParaDiaSeguinte() {
    setOntem(propostas.filter((p) => decisoes[p.id] === "aprovada"));
    setDia(2); setPropostas([]); setDecisoes({}); setChamados([]); setRoteados(null); setEventos([]); setAcionamentos([]); setUso("");
  }
  function voltarParaHoje() {
    setDia(1); setOntem([]); setPropostas([]); setDecisoes({}); setChamados([]); setRoteados(null); setEventos([]); setAcionamentos([]); setUso("");
  }
  const [pergunta, setPergunta] = useState("");
  const fimRef = useRef<HTMLDivElement>(null);

  async function rodarAgente(textoPergunta?: string) {
    setRodando(true); setEventos([]); setUso("");
    if (!textoPergunta) { setPropostas([]); setDecisoes({}); setChamados([]); setRoteados(null); setAcionamentos([]); }
    try {
      const r = await fetch("/api/agente", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meta, sensibilidade: queda, pergunta: textoPergunta, dia, aprovadasOntem: ontem.map((p) => `${p.id} ${p.regiao}: ${p.mudanca}`) }),
      });
      if (!r.ok || !r.body) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.erro ?? `HTTP ${r.status}`);
      }
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
  const pacoteTiktok = propostas.filter((p) => p.prefixosPacoteTiktok > 0);
  const tiktokAprovado = !!plano.tiktok?.valorAno && pacoteTiktok.length > 0 && pacoteTiktok.every((p) => decisoes[p.id] === "aprovada");
  const valorAprovado = aprovadas.reduce((s, p) => s + p.valorLiquidoAno, 0) + (tiktokAprovado ? plano.tiktok!.valorAno : 0);
  const totalPropostas = propostas.reduce((s, p) => s + p.valorLiquidoAno, 0) + (pacoteTiktok.length ? plano.tiktok?.valorAno ?? 0 : 0);

  const lista = useMemo(() => {
    let l = plano.prefixos;
    if (filtro === "recomendadas") l = l.filter(recomendada);
    else if (filtro !== "todas") l = l.filter((x) => x.acao === filtro);
    return l;
  }, [plano, filtro]);

  const torre = dados.torre;
  const previaRota = useMemo(() => rotearNaoPostados(dados), []);
  const multaTotal = torre.multaTransportadoras.reduce((s, m) => s + m.multaDevidaAno, 0);
  const vereditos = useMemo(() => plano.prefixos.reduce((c, x) => { const v = veredito(x); c[v] = (c[v] ?? 0) + 1; return c; }, {} as Record<Veredito, number>), [plano]);
  const comChamado = new Set(chamados.map((c) => c.id));

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
      </header>

      {/* placar */}
      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="No prazo hoje" valor={pct(plano.antes.noPrazo)} sub={`${int(plano.antes.atrasos)} atrasos e ${int(plano.antes.cancelamentos)} cancelamentos por ano`} />
        <Kpi titulo="Custo dos atrasos hoje" valor={brl(plano.antes.total)} sub={`por ano · ${brl(plano.antes.direto)} direto (atendimento + cancelamento) + recompra perdida`} />
        <Kpi destaque="azul" titulo={`Potencial · meta ${pct(meta)}`} valor={brl(pot.economiaTotal)} sub={`${pct(pot.noPrazoDepois)} no prazo · −${int(pot.atrasosEvitados)} atrasos · −${int(pot.cancelamentosEvitados)} cancelamentos/ano`} />
        <Kpi destaque="verde" titulo="Recomendado pelo agente" valor={brl(rec.valorLiquido + (plano.tiktok?.valorAno ?? 0))}
          sub={`líquido/ano · ${rec.prefixos} prefixos · ${pct(rec.noPrazoDepois)} no prazo${plano.tiktok?.valorAno ? ` · inclui ${brl(plano.tiktok.valorAno)} do TikTok Shop destravado` : ""}`} />
      </section>
      {plano.tiktok && (
        <div className={`mt-3 rounded-xl border p-3 text-sm ${plano.tiktok.capadoHoje ? "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
          <b>TikTok Shop:</b> com a loja em {pct(plano.tiktok.noPrazoLojaHoje)} de entregas no prazo (abaixo de {pct(plano.tiktok.regua)}), o algoritmo corta {pct(plano.tiktok.corte)} das vendas no canal ({pct(plano.tiktok.fatia)} das vendas).{" "}
          {plano.tiktok.destravado
            ? <>O plano leva a loja a <b>{pct(plano.tiktok.noPrazoLojaPlano)}</b> e destrava <b>+{int(plano.tiktok.pedidosRecuperadosAno)} pedidos/ano ({brl(plano.tiktok.valorAno)})</b>. Para isso inclui {plano.tiktok.prefixosExtras} prefixos que isoladamente custariam {brl(-plano.tiktok.custoDasAcoesExtras)}.</>
            : <>O plano não chega à régua com saldo positivo.</>}
          <span className="block text-[11px] opacity-70">Regra informada pela banca (parâmetro injetado em data/injetado/tiktok_shop.json); não está na base original.</span>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        {/* coluna esquerda: faixas + prefixos */}
        <div className="space-y-6 lg:col-span-3">
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="font-semibold">Veredito dos 154 prefixos</h2>
            <p className="text-xs text-slate-500">Todo prefixo é analisado; só os que precisam de mudança viram proposta.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(Object.keys(ROTULO_VEREDITO) as Veredito[]).map((v) => (
                <div key={v} className={`rounded-lg border px-3 py-2 ${COR_VEREDITO[v]}`}>
                  <div className="num text-xl font-semibold">{vereditos[v] ?? 0}</div>
                  <div className="text-xs">{ROTULO_VEREDITO[v]}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="font-semibold">Torre de controle: envios de hoje</h2>
            <p className="text-xs text-slate-500">O agente decide sozinho aqui: abre chamados e roteia envios novos. Listas da amostra (1 em cada 6 envios); multa anualizada.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="text-xs text-slate-500">Envios parados 3+ dias úteis</div>
                <div className="num text-xl font-semibold">{int(torre.emRisco.length)}</div>
                <div className="text-xs text-slate-500">{int(torre.emRisco.filter((e) => e.vencido).length)} já vencidos · {int(torre.emRisco.filter((e) => !e.vencido).length)} a vencer</div>
                <div className="mt-1 text-xs font-medium text-emerald-700">{chamados.length ? `${chamados.length} chamados abertos pelo agente` : "chamados: rode a varredura (máx. 80/dia)"}</div>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="text-xs text-slate-500">Envios novos não postados</div>
                <div className="num text-xl font-semibold">{int(torre.naoPostados.length)}</div>
                <div className="text-xs text-slate-500">{int(previaRota.roteados.length)} podem ir para transportadora melhor (≥5 p.p., máx. 40%/UF/dia)</div>
                <div className="mt-1 text-xs font-medium text-emerald-700">{roteados ? `${roteados.length} roteados pelo agente` : "rota: rode a varredura"}</div>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="text-xs text-slate-500">Multa de atraso a cobrar</div>
                <div className="num text-xl font-semibold">{brl(multaTotal)}<span className="text-xs font-normal">/ano</span></div>
                <div className="text-xs text-slate-500">contratos: 1–2% do frete por dia útil de atraso</div>
              </div>
            </div>
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <div>
                <div className="text-xs font-medium text-slate-600">Mais urgentes</div>
                <ul className="num mt-1 space-y-1 text-xs">
                  {torre.emRisco.slice(0, 6).map((e) => (
                    <li key={e.id} className="flex justify-between gap-2 border-t border-slate-100 pt-1">
                      <span><b>{e.p3}</b> {e.t} · {e.ultimoEvento.toLowerCase().slice(0, 32)} · parado {e.paradoDiasUteis}d</span>
                      <span className={comChamado.has(e.id) ? "text-emerald-700" : e.vencido ? "text-rose-700" : "text-amber-700"}>{comChamado.has(e.id) ? "chamado aberto" : e.vencido ? "vencido" : `vence ${e.prometida.slice(8, 10)}/${e.prometida.slice(5, 7)}`}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-xs font-medium text-slate-600">Cumprimento × contrato (meta 95%)</div>
                <table className="num mt-1 w-full text-xs">
                  <tbody>
                    {torre.multaTransportadoras.map((m) => (
                      <tr key={m.transportadora} className="border-t border-slate-100">
                        <td className="py-1">{m.transportadora}</td>
                        <td className={m.noPrazoEntregues < m.metaContrato ? "text-rose-700" : "text-emerald-700"}>{pct(m.noPrazoEntregues)}</td>
                        <td className="text-right">{brl(m.multaDevidaAno)}/ano</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

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
                  <tr><th className="py-1">Prefixo</th><th>Veredito</th><th>Ação</th><th>Prazo</th><th>No prazo</th><th className="text-right">Atrasos evitados</th><th className="text-right">Valor/ano</th></tr>
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
          <div className="flex rounded-xl border border-slate-200 bg-white p-1 text-sm">
            <button onClick={voltarParaHoje} className={`flex-1 rounded-lg px-3 py-2 ${dia === 1 ? "bg-slate-900 text-white" : "text-slate-600"}`}>02/11 · hoje</button>
            <button onClick={irParaDiaSeguinte} disabled={rodando} className={`flex-1 rounded-lg px-3 py-2 ${dia === 2 ? "bg-fuchsia-700 text-white" : "text-slate-600"}`}>03/11 · dia seguinte (simulado)</button>
          </div>

          {dia === 2 && (
            <section className="rounded-xl border border-fuchsia-300 bg-fuchsia-50/40 p-4 text-sm">
              <h2 className="font-semibold">Caixa do gerente · 03/11, 7h</h2>
              <p className="text-[11px] text-fuchsia-800">Dia SIMULADO para demonstração (data/injetado/dia_seguinte.json); não entra no placar.</p>
              <div className="mt-2 text-xs font-medium text-slate-600">Em vigor desde ontem (aprovado por você)</div>
              {ontem.length ? <ul className="mt-1 list-disc pl-5 text-xs">{ontem.map((p) => <li key={p.id}>{p.regiao}: {p.mudanca}</li>)}</ul>
                : <p className="mt-1 text-xs text-slate-500">Nenhuma aprovação ontem. (Para a demo: no dia 02/11, rode a varredura e aprove as propostas antes de avançar.)</p>}
              <div className="mt-3 text-xs font-medium text-slate-600">O que aconteceu durante a noite</div>
              <ul className="mt-1 space-y-0.5 text-xs">
                <li>📨 Respostas aos 80 chamados de ontem: {ds.resumo.respostas.nova_previsao ?? 0} com nova previsão · {ds.resumo.respostas.entregue ?? 0} entregues · {ds.resumo.respostas.sem_resposta ?? 0} sem resposta em 24 h · {ds.resumo.respostas.extraviado ?? 0} extraviados</li>
                <li>⏸ {ds.resumo.novosParados} envios pararam desde ontem</li>
                <li>📉 Alerta: {ds.alerta.cidade} ({ds.alerta.prefixo}) com {ds.alerta.transportadora}: {ds.alerta.noPrazoUltimos3Dias} de {ds.alerta.entreguesUltimos3Dias} no prazo nos últimos 3 dias</li>
                <li>⚠️ Mensagem no portal da {ds.mensagemPortal.transportadora}: “{ds.mensagemPortal.texto}”</li>
              </ul>
              {acionamentos.length > 0 && (
                <>
                  <div className="mt-3 text-xs font-medium text-slate-600">Precisa de você ou de alguém do time</div>
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
                <h2 className="font-semibold">Agente</h2>
                <p className="text-xs text-slate-500">{dia === 2 ? "Varredura da manhã de 03/11: trata o que mudou desde ontem." : "Roda sozinho todo dia às 7h. Aqui você roda agora."}</p>
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
                Aprovado pelo gerente: <b className="num">{brl(valorAprovado)}/ano</b> ({aprovadas.length} de {propostas.length}){pacoteTiktok.length > 0 && <> · TikTok Shop {tiktokAprovado ? <b>destravado (+{brl(plano.tiktok!.valorAno)})</b> : <>destrava quando as {pacoteTiktok.length} propostas do pacote forem aprovadas</>}</>}
              </div>
            )}
            <div className="mt-3 space-y-3">
              {propostas.length === 0 && <p className="text-sm text-slate-400">{dia === 2 && eventos.some((e) => e.tipo === "final") ? "Nenhuma proposta nova hoje: o que foi aprovado ontem segue em vigor." : "Rode a varredura para o agente abrir as propostas."}</p>}
              {propostas.map((p) => (
                <div key={p.id} className={`rounded-lg border p-3 text-sm ${decisoes[p.id] === "aprovada" ? "border-emerald-300 bg-emerald-50/50" : decisoes[p.id] === "recusada" ? "border-slate-200 opacity-50" : "border-slate-200"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{p.id} · {p.regiao} <span className="text-xs text-slate-500">({p.tipo})</span></div>
                      <div className="text-xs text-slate-500">Prefixos {p.prefixos.join(", ")}</div>
                      {p.prefixosPacoteTiktok > 0 && <div className="mt-0.5 inline-block rounded bg-fuchsia-100 px-1.5 py-0.5 text-[11px] text-fuchsia-800">pacote TikTok Shop: {p.prefixosPacoteTiktok} prefixo(s) entram para a loja passar de 92% (destrava {brl(plano.tiktok?.valorAno ?? 0)}/ano no conjunto)</div>}
                    </div>
                    <div className={`num text-right font-semibold ${p.valorLiquidoAno >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{brl(p.valorLiquidoAno)}<span className="text-xs font-normal">/ano</span></div>
                  </div>
                  <div className="mt-1">{p.mudanca}</div>
                  <div className="num mt-1 text-xs text-slate-500">No prazo {pct(p.noPrazoAntes)} → {pct(p.noPrazoDepois)} · {p.atrasosEvitadosAno >= 0 ? `−${int(p.atrasosEvitadosAno)}` : `+${int(-p.atrasosEvitadosAno)}`} atrasos · {p.cancelamentosEvitadosAno >= 0 ? `−${int(p.cancelamentosEvitadosAno)}` : `+${int(-p.cancelamentosEvitadosAno)}`} cancelamentos/ano</div>
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

      <details className="mt-8 rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <summary className="cursor-pointer font-semibold">Premissas do cálculo</summary>
        <div className="mt-3 flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">Meta de entrega no prazo</span>
            <select className="rounded-lg border border-slate-300 bg-white px-2 py-1.5" value={meta} onChange={(e) => setMeta(Number(e.target.value))}>
              {[0.92, 0.94, 0.95, 0.96].map((m) => <option key={m} value={m}>{pct(m)} por prefixo</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">Cliente desiste com prazo maior?</span>
            <select className="rounded-lg border border-slate-300 bg-white px-2 py-1.5" value={queda} onChange={(e) => setQueda(Number(e.target.value))}>
              <option value={1}>Sim, pela curva medida no checkout</option>
              <option value={0.5}>Metade da curva medida</option>
              <option value={0}>Ignorar (não perde venda)</option>
            </select>
          </label>
          <p className="max-w-md text-xs text-slate-500">
            Padrão: meta de 95% por prefixo e perda de venda pela curva medida no checkout (70 mil registros): conversão quando nosso prazo fica atrás da concorrência em{" "}
            {Object.entries(dados.curvaConversao).filter(([g]) => Number(g) >= 1 && Number(g) <= 3).map(([g, f]) => `+${g} dia(s): ${Math.round((f - 1) * 100)}%`).join(" · ")}.
          </p>
        </div>
      </details>

      <footer className="mt-4 text-xs text-slate-500">
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
        <td><span className={`rounded border px-1.5 py-0.5 text-[11px] ${COR_VEREDITO[veredito(x)]}`}>{ROTULO_VEREDITO[veredito(x)]}</span></td>
        <td><span className={`rounded-full px-2 py-0.5 text-xs ${COR_ACAO[x.acao]}`}>{ROTULO_ACAO[x.acao]}</span></td>
        <td className="text-xs">{x.prazoAtual ?? "–"}{x.prazoNovo !== x.prazoAtual && <> → <b>{x.prazoNovo}</b></>} d</td>
        <td className="text-xs">{pct(x.noPrazoAntes)}{x.noPrazoDepois !== x.noPrazoAntes && <> → <b>{pct(x.noPrazoDepois)}</b></>}</td>
        <td className="text-right text-xs">{int(x.atrasosEvitados)}</td>
        <td className={`text-right font-medium ${x.valorLiquido > 0 ? "text-emerald-700" : x.valorLiquido < 0 ? "text-rose-700" : "text-slate-400"}`}>{brl(x.valorLiquido)}</td>
      </tr>
      {aberto && (
        <tr className="bg-slate-50">
          <td colSpan={7} className="px-2 py-3 text-xs text-slate-700">
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
