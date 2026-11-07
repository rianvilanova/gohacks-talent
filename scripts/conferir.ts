// Confere os números da lib contra a análise feita à mão em PowerShell (notas.md, 10:15).
// Uso: node scripts/conferir.ts
import fs from "node:fs";
import { planoMargens, custo, fatorAno, noPrazo, total, type Dados } from "../src/lib/radar.ts";

const d: Dados = JSON.parse(fs.readFileSync("src/data/radar.json", "utf8"));
const f = fatorAno(d);
const R = (x: number) => "R$ " + Math.round(x).toLocaleString("pt-BR");
console.log(`período todo: ${(noPrazo(d.geral.todos) * 100).toFixed(1)}% no prazo (${total(d.geral.todos)} envios) | esperado 90,2%`);
console.log(`teste: ${(noPrazo(d.geral.teste) * 100).toFixed(1)}% (${total(d.geral.teste)} envios) | esperado 92,4% (11.378)`);
const base = custo(d.geral.teste, f);
console.log(`base anual: ${Math.round(base.atrasos)} atrasos, ${Math.round(base.cancelamentos)} cancel., direto ${R(base.direto)} | esperado 73.111 / 3.855 / R$ 708.423`);
for (const meta of [0.92, 0.94, 0.96]) {
  const p = planoMargens(d, meta), q = planoMargens(d, meta, true);
  console.log(`meta ${meta * 100}%: ${(p.depois.noPrazo * 100).toFixed(1)}% | atrasos ${Math.round(p.depois.atrasos)} | cancel ${Math.round(p.depois.cancelamentos)} | economia direta ${R(p.economiaDireta)} | total ${R(p.economiaTotal)} | venda perdida ${R(p.vendaPerdida)} | líquido ${R(p.liquidoDireto)} | prefixos ${p.prefixosAlterados} | +${p.diasExtrasMedios.toFixed(2)} dia`);
  console.log(`   só líquido>0: ${(q.depois.noPrazo * 100).toFixed(1)}% | economia direta ${R(q.economiaDireta)} | venda perdida ${R(q.vendaPerdida)} | líquido ${R(q.liquidoDireto)} | prefixos ${q.prefixosAlterados}`);
}

// ---- plano de ação (todos os prefixos) ----
import { planoAcoes } from "../src/lib/radar.ts";
for (const meta of [0.92, 0.94, 0.95, 0.96]) {
  const p = planoAcoes(d, meta);
  console.log(`\nPLANO meta ${meta * 100}%: ${(p.antes.noPrazo * 100).toFixed(1)}% -> ${(p.depois.noPrazo * 100).toFixed(1)}% | -${Math.round(p.atrasosEvitados)} atrasos | -${Math.round(p.cancelamentosEvitados)} cancel | direta ${R(p.economiaDireta)} | c/ recompra ${R(p.economiaTotal)} | conversão ${R(p.conversao)} | frete ${R(p.freteExtra)} | LÍQUIDO ${R(p.valorLiquido)}`);
  console.log("   ações:", JSON.stringify(p.contagem));
  if (meta === 0.95) for (const x of [...p.prefixos.slice(0, 6), ...p.prefixos.slice(-3)]) console.log(`   ${x.p3} ${x.cidade}/${x.uf} ${x.acao} m ${x.margemAtual}->${x.margemNova} ${x.transportadoraNova ?? ""} | ${(x.noPrazoAntes * 100).toFixed(0)}%->${(x.noPrazoDepois * 100).toFixed(0)}% | total ${R(x.economiaTotal)} | conv ${R(x.conversao)} | líq ${R(x.valorLiquido)}`);
}
