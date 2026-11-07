import fs from "node:fs";
import { valorRoteamentoAno, planoAcoes } from "../src/lib/radar.ts";
const d = JSON.parse(fs.readFileSync("src/data/radar.json", "utf8"));
const v = valorRoteamentoAno(d, planoAcoes(d, 0.95, 1, false));
const { roteados, ...resto } = v; console.log(resto);
