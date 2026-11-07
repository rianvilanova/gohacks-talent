// Lê os CSVs de data/transportes e gera src/data/radar.json (pequeno) para o app.
// Sem IA: só junta os 5 portais, calcula atraso em dias úteis e agrega por prefixo.
// Uso: node scripts/preparar-dados.mjs
import fs from "node:fs";
import path from "node:path";

const DIR = path.resolve("data/transportes");
const OUT = path.resolve("src/data/radar.json");
const CORTE = "2026-09-29"; // backtest: aprende antes, avalia a partir desta data
const MAXD = 15; // histograma de atraso de 0 a 15+ dias úteis
const FERIADOS = new Set(["2026-09-07", "2026-10-12", "2026-11-02", "2026-11-15", "2026-11-20", "2026-12-25", "2027-01-01"]);

function lerCsv(nome, sep = ",") {
  const txt = fs.readFileSync(path.join(DIR, nome), "utf8").replace(/^﻿/, "");
  const linhas = [];
  let campo = "", linha = [], aspas = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (aspas) {
      if (c === '"') { if (txt[i + 1] === '"') { campo += '"'; i++; } else aspas = false; }
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && txt[i + 1] === "\n") i++;
      linha.push(campo); campo = "";
      if (linha.length > 1 || linha[0] !== "") linhas.push(linha);
      linha = [];
    } else campo += c;
  }
  if (campo !== "" || linha.length) { linha.push(campo); linhas.push(linha); }
  const [cab, ...resto] = linhas;
  return resto.map((l) => Object.fromEntries(cab.map((h, j) => [h, l[j] ?? ""])));
}

// ---------- dias úteis ----------
const ehUtil = (iso) => {
  const d = new Date(iso + "T12:00:00Z").getUTCDay();
  return d !== 0 && d !== 6 && !FERIADOS.has(iso);
};
const somaDia = (iso, n) => {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
function diasUteisEntre(a, b) { // dias úteis em (a, b]
  let n = 0, d = a;
  while (d < b) { d = somaDia(d, 1); if (ehUtil(d)) n++; }
  return n;
}

// ---------- 1. juntar os 5 portais: primeira data de entrega por código ----------
const entrega = new Map();
const norm = (c) => c.trim().toUpperCase(); // portais gravam parte dos códigos em minúsculas/com espaços
const vistos = new Set(); // códigos com qualquer evento em algum portal (janela de ~60 dias)
const EXPORTACAO = "2026-11-02"; // portais exportados em 02/11 06:00
const marca = (c, iso) => { const cod = norm(c); if (!entrega.has(cod) || iso < entrega.get(cod)) entrega.set(cod, iso); };

for (const r of lerCsv("portal_expressa_ja.csv")) if (/^ENTREGUE/.test(r.evento)) marca(r.codigo_rastreio, r.data_hora.slice(0, 10));
for (const r of lerCsv("portal_transnorte.csv")) if (r.status === "entregue") marca(r.rastreio, r.quando.slice(0, 10));
for (const r of lerCsv("portal_rapido_sul.csv", ";")) if (/^Entregue/.test(r.ocorrencia)) {
  const [dd, mm, yyyy] = r.data_hora.slice(0, 10).split("/");
  marca(r.rastreio, `${yyyy}-${mm}-${dd}`);
}
const codVialog = Object.fromEntries(lerCsv("portal_vialog_codigos.csv").map((r) => [r.cod_status, r.descricao]));
for (const r of lerCsv("portal_vialog.csv")) if (/^Entregue/.test(codVialog[r.cod_status] ?? "")) marca(r.awb, r.timestamp.slice(0, 10));
for (const r of lerCsv("portal_correio_agil.csv")) if (/^Objeto entregue/.test(r.descricao)) {
  const local = new Date(new Date(r.data_hora_utc).getTime() - 3 * 3600e3); // UTC -> Brasília
  marca(r.objeto, local.toISOString().slice(0, 10));
}

for (const [arq, col, sep] of [["portal_expressa_ja.csv", "codigo_rastreio", ","], ["portal_transnorte.csv", "rastreio", ","], ["portal_rapido_sul.csv", "rastreio", ";"], ["portal_vialog.csv", "awb", ","], ["portal_correio_agil.csv", "objeto", ","]])
  for (const r of lerCsv(arq, sep)) vistos.add(norm(r[col]));

// ---------- 2. envios: atraso em dias úteis ----------
const novoHist = () => ({ n: Array(MAXD + 1).fill(0), v: Array(MAXD + 1).fill(0) });
const addHist = (h, d, v) => { const i = Math.min(d, MAXD); h.n[i]++; h.v[i] = Math.round((h.v[i] + v) * 100) / 100; };

const envios = lerCsv("envios.csv");
const pref = {}; // p3 -> agregados
const geral = { todos: novoHist(), treino: novoHist(), teste: novoHist() };
const porTransp = {};
let casados = 0, semEntrega = 0;
const envioP3 = new Map();
for (const e of envios) {
  const p3 = e.cep.slice(0, 3);
  envioP3.set(e.envio_id, p3);
  const ent = entrega.get(norm(e.codigo_rastreio));
  let atraso;
  if (ent) { casados++; atraso = ent > e.data_prometida ? diasUteisEntre(e.data_prometida, ent) : 0; }
  else if (vistos.has(norm(e.codigo_rastreio)) && e.data_prometida < EXPORTACAO) {
    // está no portal, prazo vencido e nunca entregue (extravio, devolução, parado): conta como atraso até a exportação
    semEntrega++; atraso = Math.max(1, diasUteisEntre(e.data_prometida, EXPORTACAO));
  } else continue; // fora da janela dos portais ou ainda dentro do prazo

  const v = Number(e.valor_pedido);
  const periodo = e.data_pedido.slice(0, 10) < CORTE ? "treino" : "teste";
  const P = (pref[p3] ??= { uf: e.uf, cidades: {}, todos: novoHist(), treino: novoHist(), teste: novoHist(), transp: {} });
  P.cidades[e.cidade] = (P.cidades[e.cidade] ?? 0) + 1;
  addHist(P.todos, atraso, v); addHist(P[periodo], atraso, v);
  const T = (P.transp[e.transportadora] ??= { todos: novoHist(), treino: novoHist(), teste: novoHist() });
  addHist(T.todos, atraso, v); addHist(T[periodo], atraso, v);
  addHist(geral.todos, atraso, v); addHist(geral[periodo], atraso, v);
  const G = (porTransp[e.transportadora] ??= novoHist());
  addHist(G, atraso, v);
}

// ---------- 3. regras atuais do site por prefixo ----------
const regras = {};
for (const r of lerCsv("regras_site_prazo_frete_por_prefixo.csv")) regras[r.prefixo_cep3] = {
  cidade: r.cidade_referencia, uf: r.uf, localidade: r.localidade, transportadora: r.transportadora_padrao,
  sla: Number(r.sla_contratual_dias_uteis), margem: Number(r.margem_seguranca_dias),
  prazo: Number(r.prazo_exibido_dias_uteis), frete: Number(r.frete_cobrado),
};

// ---------- 4. quem atende cada UF/localidade ----------
const cobertura = {};
for (const r of lerCsv("transportadoras_cobertura_sla.csv")) if (r.atende === "sim") {
  (cobertura[`${r.uf}|${r.localidade}`] ??= []).push({ transportadora: r.transportadora, sla: Number(r.sla_contratual_dias_uteis) });
}

// ---------- 5. custo médio cotado por prefixo x transportadora ----------
const frete = {};
for (const r of lerCsv("cotacoes_frete.csv")) {
  const p3 = envioP3.get(r.envio_id); if (!p3) continue;
  const k = `${p3}|${r.transportadora}`;
  const f = (frete[k] ??= [0, 0]); f[0] += Number(r.valor_cotado); f[1]++;
}

// ---------- 6. prazo dos concorrentes por prefixo (mediana) ----------
const conc = {};
for (const r of lerCsv("concorrentes_prazos.csv")) (conc[r.cep.slice(0, 3)] ??= []).push(Number(r.prazo_dias_uteis));
const mediana = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

// ---------- saída ----------
const prefixos = Object.entries(pref).map(([p3, P]) => {
  const cidade = Object.entries(P.cidades).sort((a, b) => b[1] - a[1])[0][0];
  const regra = regras[p3] ?? null;
  const atende = regra ? (cobertura[`${regra.uf}|${regra.localidade === "capital" ? "capital_e_metropolitana" : regra.localidade}`] ?? cobertura[`${regra.uf}|${regra.localidade}`] ?? []) : [];
  const transp = Object.fromEntries(Object.entries(P.transp).map(([t, T]) => {
    const f = frete[`${p3}|${t}`];
    return [t, { ...T, freteMedio: f ? Math.round((f[0] / f[1]) * 100) / 100 : null }];
  }));
  const fretePorTransp = Object.fromEntries(
    Object.entries(frete).filter(([k]) => k.startsWith(p3 + "|")).map(([k, f]) => [k.split("|")[1], Math.round((f[0] / f[1]) * 100) / 100]),
  );
  return {
    p3, uf: P.uf, cidade, regra, atende, todos: P.todos, treino: P.treino, teste: P.teste, transp, fretePorTransp,
    concorrentesPrazoMediana: mediana(conc[p3] ?? []), concorrentesColetas: (conc[p3] ?? []).length,
  };
}).sort((a, b) => a.p3.localeCompare(b.p3));

const saida = {
  geradoEm: new Date().toISOString(),
  corteBacktest: CORTE,
  enviosNaAmostra: envios.length,
  enviosComEntrega: casados,
  enviosSemEntregaVencidos: semEntrega,
  enviosPorAno: Math.round((envios.length * 6 * 365) / 90), // amostra 1 em 6, 90 dias
  geral, porTransp, prefixos,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(saida));
console.log(`entregas nos portais: ${entrega.size} | envios casados: ${casados} | sem entrega e vencidos: ${semEntrega} de ${envios.length} | prefixos: ${prefixos.length}`);
console.log(`arquivo: ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
