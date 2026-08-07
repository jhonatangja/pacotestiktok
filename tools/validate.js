// ---------------------------------------------------------------------------
// tools/validate.js — valida o núcleo contra a planilha real.
//
//   node tools/validate.js [caminho.xlsx]
//
// Confere os números apurados na análise da amostra de 06/08/2026 e falha com
// código 1 se o motor divergir. Roda em Node, sem navegador.
// ---------------------------------------------------------------------------

import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildEvents, dedupeEvents, mergeEvents } from "../src/ingest.js";
import { buildPackages, codigosEmAberto } from "../src/domain.js";
import { createMemoryRepo } from "../src/repo.js";
import { separarCodigos } from "../src/tratativa.js";
import { normalizarTelefone, telefoneValido, linkWhatsApp } from "../src/contatos.js";
import { pacotesDoGalpao } from "../src/ui/galpao.js";
import { pacotesResolvidos } from "../src/ui/resolvidos.js";
import { noCircuito } from "../src/ui/fechamento.js";
import { ACAO, definirAutor, novaAtividade, cobradoHoje } from "../src/atividades.js";
import { FLAG, SITUACAO } from "../src/config.js";

const require = createRequire(import.meta.url);
const XLSX = require("../vendor/xlsx.full.min.js");

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// -- entrada ----------------------------------------------------------------
const alvo = process.argv[2] ??
  join(raiz, readdirSync(raiz).find((f) => f.endsWith(".xlsx") && !f.startsWith("~$")) ?? "");

// o bundle "full" do SheetJS é o do navegador e não enxerga `fs` — lemos os bytes aqui
const wb = XLSX.read(readFileSync(alvo), { type: "buffer", cellDates: true });
const grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: true });
const headers = grid[0].map((h) => String(h ?? "").trim());
const rows = grid.slice(1).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));

// -- pipeline ---------------------------------------------------------------
const { events, unknownTypes, skipped, missing } = buildEvents(rows, headers, { sourceFile: alvo });
if (missing.length) {
  console.error("Colunas obrigatórias não encontradas:", missing.map((m) => m.header).join(", "));
  process.exit(1);
}

const limpos = dedupeEvents(events);

// "agora" = último evento da base, para o resultado não mudar com o passar dos dias
const agora = Math.max(...limpos.map((e) => e.ts));
const { packages, byDriver, resumo } = buildPackages(limpos, { now: agora });

// -- relatório --------------------------------------------------------------
const linha = (n = 78) => console.log("─".repeat(n));

console.log(`\nArquivo: ${alvo.split(/[\\/]/).pop()}`);
console.log(`Referência de tempo: ${new Date(agora).toLocaleString("pt-BR")}\n`);
linha();
console.log(`Linhas lidas .............. ${rows.length}`);
console.log(`Eventos válidos ........... ${events.length}${skipped ? `  (${skipped} linhas descartadas)` : ""}`);
console.log(`Após deduplicação ......... ${limpos.length}  (${events.length - limpos.length} colapsados)`);
console.log(`Pacotes ................... ${resumo.totalPacotes}`);
console.log(`Despachos ................. ${resumo.totalDespachos}  (${resumo.despachosAbertos} abertos)`);
if (unknownTypes.length) {
  console.log(`\n⚠ Tipos de bipagem desconhecidos (mapear em config.js):`);
  for (const u of unknownTypes) console.log(`   ${u.count}×  ${u.type}`);
}

linha();
console.log("SITUAÇÃO");
for (const [s, n] of Object.entries(resumo.porSituacao)) console.log(`  ${String(n).padStart(3)}  ${s}`);
console.log("\nFLAGS");
for (const [f, n] of Object.entries(resumo.porFlag)) console.log(`  ${String(n).padStart(3)}  ${f}`);

linha();
console.log("PACOTES (ordem de criticidade)\n");
for (const p of packages) {
  console.log(`${p.pkgId}  ${p.situacaoLabel}  ·  ${p.acao}  ·  prioridade ${p.prioridade}`);
  console.log(`   ${p.destCity ?? "?"}/${p.destState ?? "?"}  ·  ${p.diasDesdeColeta}d desde a coleta` +
              `  ·  parado há ${p.horasSemMovimento}h` +
              (p.horasAteExpedir != null ? `  ·  ${p.horasAteExpedir}h até expedir da base` : ""));
  for (const d of p.despachos) {
    const fim = d.aberto ? `EM ABERTO há ${d.horasPosse}h`
      : d.anomalia ? `REBIPADO ${d.horasPosse}h depois SEM TRATATIVA`
      : `${d.closedBy} após ${d.horasPosse}h`;
    console.log(`   · ${new Date(d.startedAt).toLocaleString("pt-BR")}  ${d.driver.padEnd(34)} → ${fim}`);
  }
  if (p.flags.length) console.log(`   flags: ${p.flags.join(", ")}`);
  console.log();
}

linha();
console.log("COBRANÇA POR MOTORISTA\n");
for (const m of byDriver) {
  console.log(`${m.driver.padEnd(36)} abertos:${String(m.totalAbertos).padStart(2)}  ` +
              `rebipes:${String(m.totalRebipes).padStart(2)}  ` +
              `ocorr.lentas:${String(m.ocorrenciasLentas.length).padStart(2)}  ` +
              `mais antigo:${String(m.horasMaisAntiga).padStart(6)}h  score:${m.score}`);
}

linha();
console.log(`CÓDIGOS PARA RECONSULTAR NO JMS (${codigosEmAberto(packages).length})`);
console.log(codigosEmAberto(packages).join("\n"));

// -- asserções --------------------------------------------------------------
linha();
const checks = [];
const check = (nome, real, esperado) => checks.push({ nome, real, esperado, ok: real === esperado });

check("pacotes", resumo.totalPacotes, 9);
check("linhas lidas", rows.length, 214);
check("eventos válidos", events.length, 214);
check("rebipe sem tratativa", resumo.porFlag[FLAG.REBIPE_SEM_TRATATIVA] ?? 0, 3);
check("troca de motorista", resumo.porFlag[FLAG.TROCA_DE_MOTORISTA] ?? 0, 1);
// 4 e não 2: além dos dois casos de 54h, há outros dois de 10,4h e 23,5h que
// também estouram o limite de 4h para registrar a problemática.
check("ocorrência lenta", resumo.porFlag[FLAG.OCORRENCIA_LENTA] ?? 0, 4);
// 3 e não 2: com o limite de 12h, o pacote de 27,9h entra junto com os de 72h+.
check("parado na base", resumo.porFlag[FLAG.PARADO_NA_BASE] ?? 0, 3);
check("retornado ao galpão", resumo.porSituacao[SITUACAO.RETORNADO_GALPAO] ?? 0, 1);
check("ocorrência em aberto", resumo.porSituacao[SITUACAO.OCORRENCIA_EM_ABERTO] ?? 0, 1);

// os três rebipes nominais apurados na análise
const rebipeDe = (pkg) => packages.find((p) => p.pkgId === pkg)
  ?.despachos.find((d) => d.anomalia === FLAG.REBIPE_SEM_TRATATIVA);
check("rebipe de 29,6h", rebipeDe("999881516619685")?.horasPosse, 29.6);
check("rebipe de 72,4h", rebipeDe("999881559133398")?.horasPosse, 72.4);
check("rebipe de 1h (com troca de motorista)", rebipeDe("999881566596288")?.horasPosse, 1);

// idempotência: reimportar o mesmo arquivo não pode mudar nada
const remerge = mergeEvents(limpos, dedupeEvents(buildEvents(rows, headers).events));
check("idempotência (nada adicionado na 2ª importação)", remerge.added, 0);
check("idempotência (total estável)", remerge.total, limpos.length);

// o relógio da base começa no `bipe de recebimento`, não na coleta
const naBase = packages.find((p) => p.pkgId === "999881516619685");
check("horas na base (recebido 01/08 10:03)", naBase.horasNaBase, 128);
check("em trânsito não tem relógio de base",
  packages.every((p) => p.recebidoNaBaseEm != null || p.horasNaBase === null), true);

// ticket do cliente: marca a flag e joga o pacote para o topo da fila
const alvoTicket = "999881572437952";           // pacote de baixa prioridade na base
const antesDoTicket = packages.find((p) => p.pkgId === alvoTicket);
const comTicket = buildPackages(limpos, {
  now: agora,
  tratativas: { [alvoTicket]: { pkgId: alvoTicket, status: "aberta", ticket: { aberto: true, ref: "TT-1" } } },
});
const depoisDoTicket = comTicket.packages.find((p) => p.pkgId === alvoTicket);

check("ticket marca a flag", depoisDoTicket.flags.includes(FLAG.TICKET_CLIENTE), true);
check("ticket eleva a prioridade", depoisDoTicket.prioridade > antesDoTicket.prioridade, true);
check("ticket vira o primeiro da fila", comTicket.packages[0].pkgId, alvoTicket);
check("ticket aparece na conta do motorista",
  comTicket.byDriver.find((m) => m.tickets.length)?.totalTickets, 1);
// tratativa resolvida encerra o ticket — não fica cobrando o que já acabou
const resolvido = buildPackages(limpos, {
  now: agora,
  tratativas: { [alvoTicket]: { pkgId: alvoTicket, status: "resolvida", ticket: { aberto: true } } },
}).packages.find((p) => p.pkgId === alvoTicket);
check("ticket some quando a tratativa é resolvida", resolvido.flags.includes(FLAG.TICKET_CLIENTE), false);

// resolvido sai das pendências, da cobrança e da fila do galpão
const alvoResolver = "999881516619685";        // o pacote do galpão
const comResolvido = buildPackages(limpos, {
  now: agora,
  tratativas: { [alvoResolver]: {
    pkgId: alvoResolver, status: "resolvida", responsavel: "Operador",
    atualizadaEm: new Date(agora + 3600000).toISOString(),   // encerrado depois do último bipe
  } },
});
const jaResolvido = comResolvido.packages.find((p) => p.pkgId === alvoResolver);

check("resolvido marca o pacote", jaResolvido.resolvido, true);
check("resolvido sai das pendências do galpão",
  pacotesDoGalpao(comResolvido.packages).length, 0);
check("resolvido não gera cobrança",
  comResolvido.byDriver.some((m) => m.pacotes.includes(alvoResolver)), false);
check("resolvido vai para o fim da fila",
  comResolvido.packages[comResolvido.packages.length - 1].pkgId, alvoResolver);
check("resolvido aparece na aba Resolvidos",
  pacotesResolvidos(comResolvido.packages).map((p) => p.pkgId).join(), alvoResolver);

// bipe posterior à resolução reabre o caso sozinho
const reaberto = buildPackages(limpos, {
  now: agora,
  tratativas: { [alvoResolver]: {
    pkgId: alvoResolver, status: "resolvida",
    atualizadaEm: new Date(agora - 86400000).toISOString(),  // encerrado ANTES do último bipe
  } },
}).packages.find((p) => p.pkgId === alvoResolver);

check("movimento após resolver reabre o caso", reaberto.resolvido, false);
check("reabertura é sinalizada", reaberto.flags.includes(FLAG.MOVIMENTO_APOS_RESOLVIDA), true);

// contato do motorista: normaliza qualquer forma de digitar para o wa.me
check("telefone com máscara vira dígitos+55", normalizarTelefone("(64) 99999-8888"), "5564999998888");
check("telefone sem DDD é inválido", telefoneValido("99999-8888"), false);
check("link do WhatsApp embute a mensagem",
  linkWhatsApp("64999998888", "oi").startsWith("https://wa.me/5564999998888?text="), true);

// recebido em outra base: encerra sozinho, sem decisão humana
const alvoOutraBase = "999881582349743";
const comOutraBase = buildPackages(
  [...limpos, {
    id: "sintetico|outra-base", pkgId: alvoOutraBase,
    ts: agora + 3600000, tsISO: "sintetico",
    rawType: "bipe de recebimento", fact: "RECEBIDO_BASE", stage: "BASE_FINAL",
    label: "Recebido na base final", base: "GO ITU - GO",
  }],
  { now: agora + 7200000 }
).packages.find((p) => p.pkgId === alvoOutraBase);

check("outra base encerra o pacote", comOutraBase.resolvido, true);
check("outra base vira situação própria", comOutraBase.situacao, SITUACAO.RECEBIDO_OUTRA_BASE);
check("outra base é identificada", comOutraBase.outraBase, "GO ITU - GO");
check("outra base sai do circuito", noCircuito([comOutraBase]).length, 0);
check("recebimento na própria base não confunde",
  packages.find((p) => p.pkgId === alvoOutraBase).resolvido, false);

// registro de ações: autor, hora e cobrança do dia
definirAutor("samuel");
const ato = novaAtividade("999881527748083", ACAO.COBRANCA, "DORAILDO");
check("atividade grava o autor", ato.autor, "samuel");
check("atividade identifica o pacote certo", cobradoHoje([ato], "999881527748083"), true);
check("atividade não vaza para outro pacote", cobradoHoje([ato], "999881544281038"), false);
// dois operadores no mesmo instante geram registros distintos
definirAutor("jessica");
const ato2 = novaAtividade("999881527748083", ACAO.COBRANCA, "DORAILDO");
check("dois autores não se sobrescrevem", ato.id === ato2.id, false);

// lançamento de tickets em lote: aceita a colagem como ela vem
const colagem = "999881527748083\n999881549481448, 999881582349743\t999881527748083\n\n";
check("separa códigos de qualquer colagem", separarCodigos(colagem).length, 3);
check("colagem não duplica código repetido",
  separarCodigos(colagem).filter((c) => c === "999881527748083").length, 1);
check("colagem vazia não vira código", separarCodigos("  \n , ; \n").length, 0);

// tratativas sobrevivem a uma reimportação
const repo = createMemoryRepo();
await repo.putEvents(limpos);
await repo.putTreatment({ pkgId: "999881516619685", responsavel: "Operador", status: "aberta" });
await repo.putEvents(limpos);
check("tratativa preservada após reimportar", (await repo.getTreatments()).length, 1);

console.log("VALIDAÇÃO\n");
let falhas = 0;
for (const c of checks) {
  if (!c.ok) falhas++;
  console.log(`  ${c.ok ? "✓" : "✗"} ${c.nome.padEnd(46)} ${c.real}${c.ok ? "" : `  (esperado ${c.esperado})`}`);
}
console.log();
console.log(falhas === 0 ? "Tudo certo." : `${falhas} verificação(ões) falharam.`);
process.exit(falhas === 0 ? 0 : 1);
