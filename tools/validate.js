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

import { buildEvents, dedupeEvents, mergeEvents, normalize, reclassifyEvents, stripDriverPrefix } from "../src/ingest.js";
import { buildPackages, codigosEmAberto } from "../src/domain.js";
import { codigosParaReconsultar } from "../src/export.js";
import { createMemoryRepo } from "../src/repo.js";
import { separarCodigos } from "../src/tratativa.js";
import { mensagemCobranca, prazoDaCobranca } from "../src/charge.js";
import { aguardandoImportacao } from "../src/aguardando.js";
import { normalizarTelefone, telefoneValido, linkWhatsApp } from "../src/contatos.js";
import { pacotesDoGalpao } from "../src/ui/galpao.js";
import { listarMotoristas } from "../src/ui/motoristas.js";
import { pacotesResolvidos } from "../src/ui/resolvidos.js";
import { noCircuito } from "../src/ui/fechamento.js";
import { daBase } from "../src/ui/painel.js";
import { ACAO, definirAutor, novaAtividade, cobradoHoje } from "../src/atividades.js";
import { FLAG, SITUACAO, SITUACAO_META, FACT, STAGE, SCAN_TYPES, FECHAMENTOS,
         responsavelDaConta, ehBasePropria, apelidoDaBase } from "../src/config.js";
import { VERSAO, ARQUIVOS } from "../src/versao.js";

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

// `assinatura de encomenda`: a baixa que o próprio JMS dá. Encerra o pacote
// sem depender de decisão de ninguém na base.
check("assinatura de encomenda está mapeada",
  SCAN_TYPES[normalize("assinatura de encomenda")]?.fact, FACT.ENTREGA);
check("assinatura fecha despacho", FECHAMENTOS.includes(FACT.ENTREGA), true);

const alvoEntrega = "999881516619685";                 // estava com motorista, em aberto

// evento antigo, guardado antes do tipo existir no dicionário, é reclassificado
// na leitura — o histórico já no banco passa a valer sem reimportar nada
const velho = { id: "x", pkgId: alvoEntrega, ts: agora, rawType: "assinatura de encomenda",
                fact: FACT.OUTRO, stage: STAGE.OUTRO, label: "assinatura de encomenda" };
check("bipe antigo é reclassificado na leitura", reclassifyEvents([velho])[0].fact, FACT.ENTREGA);

// a filial aparece numerada em alguns bipes e não pode virar outro motorista
check("prefixo da filial some", stripDriverPrefix("F RVD - MAYCON SILVA MOURA", "F RVD -"), "MAYCON SILVA MOURA");
check("prefixo numerado da filial também some",
  stripDriverPrefix("F RVD 02 - MAYCON SILVA MOURA", "F RVD -"), "MAYCON SILVA MOURA");
check("nome sem prefixo passa intacto",
  stripDriverPrefix("MAYCON SILVA MOURA", "F RVD -"), "MAYCON SILVA MOURA");
check("reclassificar não mexe em quem já estava certo",
  reclassifyEvents(limpos).filter((e, i) => e !== limpos[i]).length, 0);

check("antes da assinatura o pacote está no circuito",
  packages.find((p) => p.pkgId === alvoEntrega).resolvido, false);

const assinatura = {
  id: `${alvoEntrega}|sintetico|assinatura`, pkgId: alvoEntrega,
  ts: agora + 3600000, tsISO: new Date(agora + 3600000).toISOString(),
  rawType: "assinatura de encomenda", fact: FACT.ENTREGA, stage: STAGE.ENTREGUE,
  label: "Entregue ao cliente", base: "F RVD - GO",
  scanner: "F RVD - CONFERENTE", courier: "F RVD - MOTORISTA DE TESTE",
};
const comEntrega = buildPackages([...limpos, assinatura], {
  now: agora + 7200000,
  // mesmo marcado à mão como "em andamento", a assinatura manda
  tratativas: { [alvoEntrega]: { pkgId: alvoEntrega, status: "em_andamento",
                                 ticket: { aberto: true, ref: "TT-9" } } },
});
const entregue = comEntrega.packages.find((p) => p.pkgId === alvoEntrega);

check("assinatura resolve o pacote", entregue.resolvido, true);
check("assinatura vira desfecho entregue", entregue.desfecho, "entregue");
check("assinatura vira situação própria", entregue.situacao, SITUACAO.ENTREGUE);
check("assinatura carimba a data da baixa", entregue.resolvidaEm, assinatura.ts);
check("assinatura identifica quem entregou", entregue.entreguePor, "MOTORISTA DE TESTE");
check("assinatura fecha o despacho aberto",
  entregue.despachos.every((d) => !d.aberto), true);
check("entregue sai do circuito",
  noCircuito(comEntrega.packages).some((p) => p.pkgId === alvoEntrega), false);
check("entregue sai da cobrança do motorista",
  comEntrega.byDriver.some((m) => m.pacotes.includes(alvoEntrega)), false);
check("entregue não é mais cliente aguardando", entregue.clienteAguardando, false);
check("ticket aberto não segura um pacote entregue", entregue.ticketAberto, false);
check("entregue vai para os resolvidos",
  pacotesResolvidos(comEntrega.packages).some((p) => p.pkgId === alvoEntrega), true);
check("entregue não conta como voltou a se mover",
  entregue.flags.includes(FLAG.MOVIMENTO_APOS_RESOLVIDA), false);
check("entregue sai da lista de reconsultar no JMS",
  codigosParaReconsultar(comEntrega.packages, {}).includes(alvoEntrega), false);

// a lista de arquivos da auto-atualização não pode ficar para trás: um módulo
// fora dela continuaria velho no cache depois de publicar
const modulos = [];
for (const dir of ["src", "src/ui"]) {
  for (const f of readdirSync(join(raiz, dir))) {
    if (f.endsWith(".js")) modulos.push(`${dir}/${f}`);
  }
}
const faltando = modulos.filter((m) => !ARQUIVOS.includes(m));
check("auto-atualização cobre todos os módulos", faltando.join(",") || "nenhum", "nenhum");
check("versão tem formato de data", /^\d{4}-\d{2}-\d{2}\.\d+$/.test(VERSAO), true);
// a versão é lida do texto do arquivo publicado: a regex tem que achar a
// constante, não um exemplo dentro de um comentário
const fonteVersao = readFileSync(join(raiz, "src/versao.js"), "utf8");
check("versão é lida do arquivo sem confundir com comentário",
  fonteVersao.match(/^export const VERSAO\s*=\s*"([^"]+)"/m)?.[1], VERSAO);

// contas de tratativa da base respondem pelo assistente, não pelo nome do JMS
check("conta traduz para o assistente da base",
  responsavelDaConta("SAMARA KELLIS PEREIRA DOS SANTOS"), "SAMUEL RVD 1");
check("tradução ignora caixa e acento", responsavelDaConta("dionatan dos santos"), "MARCOS RVD 2");
check("motorista de rua não é traduzido", responsavelDaConta("DORAILDO ALVES DE OLIVEIRA"), null);

const contaJms = "SAMARA KELLIS PEREIRA DOS SANTOS";
const assistente = "SAMUEL RVD 1";
const alvoBase = "999881572437952";
const despachoNaBase = {
  id: `${alvoBase}|sintetico|tratativa`, pkgId: alvoBase,
  ts: agora + 1800000, tsISO: new Date(agora + 1800000).toISOString(),
  rawType: "bipe de saída para entrega", fact: FACT.DESPACHO, stage: STAGE.COM_MOTORISTA,
  label: "Saiu para entrega", base: "F RVD - GO",
  scanner: "F RVD - CONFERENTE", courier: `F RVD - ${contaJms}`,
};
const comConta = buildPackages([...limpos, despachoNaBase], { now: agora + 40 * 3600000 });
const naBase2 = comConta.packages.find((p) => p.pkgId === alvoBase);
const ultimoDespacho = naBase2.despachos[naBase2.despachos.length - 1];

check("bipe para conta de tratativa vira ação própria",
  naBase2.situacao, SITUACAO.EM_TRATATIVA_BASE);
check("tratativa na base tem ação separada",
  SITUACAO_META[SITUACAO.EM_TRATATIVA_BASE].acao, "Tratar na base");
check("o responsável é o assistente, não a conta", naBase2.motoristaAtual, assistente);
check("o nome do JMS não aparece como motorista",
  naBase2.motoristasEnvolvidos.includes(contaJms), false);
check("a conta original fica registrada para auditoria", ultimoDespacho.contaNoJms, contaJms);
check("o pacote é marcado como na base", naBase2.naBase, true);
// a responsabilidade é do assistente: ele responde igual a qualquer motorista
check("o assistente entra na cobrança",
  comConta.byDriver.some((m) => m.driver === assistente), true);
check("a conta do JMS não entra na cobrança",
  comConta.byDriver.some((m) => m.driver === contaJms), false);
check("o assistente entra no cadastro de responsáveis",
  listarMotoristas(comConta.packages, comConta.byDriver, {}).some((m) => m.driver === assistente), true);
check("a conta do JMS some do cadastro",
  listarMotoristas(comConta.packages, comConta.byDriver, {}).some((m) => m.driver === contaJms), false);

// duas bases nossas em Rio Verde: trocar entre elas não encerra nada
check("a base principal é nossa", ehBasePropria("F RVD - GO"), true);
check("a segunda base também é nossa", ehBasePropria("F RVD 02-GO"), true);
check("base de fora não é nossa", ehBasePropria("F APG - GO"), false);
check("base sem nome não encerra por engano", ehBasePropria(""), true);

const alvoBase2 = "999881549481448";
const recebeuNaDois = {
  id: `${alvoBase2}|sintetico|rvd2`, pkgId: alvoBase2,
  ts: agora + 900000, tsISO: new Date(agora + 900000).toISOString(),
  rawType: "bipe de recebimento", fact: FACT.RECEBIDO_BASE, stage: STAGE.BASE_FINAL,
  label: "Recebido na base final", base: "F RVD 02-GO", scanner: "F RVD 02 - CONFERENTE",
};
const comBase2 = buildPackages([...limpos, recebeuNaDois], { now: agora + 20 * 3600000 });
const naDois = comBase2.packages.find((p) => p.pkgId === alvoBase2);

check("recebimento na segunda base NÃO encerra o pacote", naDois.resolvido, false);
check("recebimento na segunda base não vira 'outra base'",
  naDois.situacao === SITUACAO.RECEBIDO_OUTRA_BASE, false);
check("a responsabilidade passa para a segunda base", naDois.baseResponsavel, "F RVD 02-GO");
check("a transferência entre bases é sinalizada", naDois.transferidoEntreBases, true);
check("o pacote continua no circuito",
  noCircuito(comBase2.packages).some((p) => p.pkgId === alvoBase2), true);
check("o pacote continua na lista de reconsultar",
  codigosParaReconsultar(comBase2.packages, {}).includes(alvoBase2), true);

// base de FORA continua encerrando, como antes
const recebeuFora = { ...recebeuNaDois, id: `${alvoBase2}|sintetico|fora`, base: "F APG - GO" };
const comFora = buildPackages([...limpos, recebeuFora], { now: agora + 20 * 3600000 });
const fora = comFora.packages.find((p) => p.pkgId === alvoBase2);
check("base de fora encerra o pacote", fora.resolvido, true);
check("base de fora vira desfecho de outra base", fora.desfecho, "outra_base");

// o filtro do painel separa a responsabilidade
check("filtro por base isola a segunda",
  daBase(comBase2.packages, "F RVD 02-GO").every((p) => p.baseResponsavel === "F RVD 02-GO"), true);
check("filtro vazio devolve tudo",
  daBase(comBase2.packages, "").length, comBase2.packages.length);
check("apelido encurta o nome da base", apelidoDaBase("F RVD 02-GO"), "RVD 2");

// cobrança: todo pacote no circuito é cliente esperando, e o prazo exigido
// muda sozinho no corte das 14h
const noCircuitoAgora = noCircuito(packages);
check("todo pacote no circuito é cliente aguardando",
  noCircuitoAgora.every((p) => p.clienteAguardando), true);
check("pacote em trânsito não é cliente aguardando",
  packages.filter((p) => p.situacao === SITUACAO.EM_TRANSITO).every((p) => !p.clienteAguardando), true);

const manha = new Date(2026, 7, 6, 9, 30);
const tarde = new Date(2026, 7, 6, 16, 30);
check("antes das 14h cobra para hoje", prazoDaCobranca(manha).antesDoCorte, true);
check("depois das 14h cobra para amanhã", prazoDaCobranca(tarde).antesDoCorte, false);

const alvoCobranca = byDriver.find((d) => d.abertos.length) ?? byDriver[0];
const msgManha = mensagemCobranca(alvoCobranca, {}, manha);
const msgTarde = mensagemCobranca(alvoCobranca, {}, tarde);
check("mensagem da manhã exige entrega hoje", msgManha.includes("entregues HOJE"), true);
check("mensagem da manhã não fala de amanhã", msgManha.includes("AMANHÃ"), false);
// depois das 14h a ordem continua sendo tentar hoje — a manhã seguinte é o
// plano B para o que não couber mais no dia, não uma dispensa do dia
check("mensagem da tarde manda tentar hoje", msgTarde.includes("Tente entregar ainda hoje"), true);
check("mensagem da tarde dá a manhã seguinte como alternativa",
  msgTarde.includes("AMANHÃ LOGO PELA MANHÃ"), true);
check("mensagem da tarde não trata o dia como perdido",
  msgTarde.includes("Já passou das"), false);
// singular e plural saem certos nos dois horários
check("prazo no singular", prazoDaCobranca(manha, { quantidade: 1 }).linhas[0].includes("Precisa ser entregue"), true);
check("prazo no plural", prazoDaCobranca(manha, { quantidade: 3 }).linhas[0].includes("Precisam ser entregues"), true);
// a evidência é exigida nos dois horários — é ela que sustenta a problemática
check("evidência exigida de manhã", msgManha.includes("evidência da tentativa de contato"), true);
check("evidência exigida à tarde", msgTarde.includes("evidência da tentativa de contato"), true);
// a cobrança deixou de ter duas listas: nada é apresentado como "sem baixa"
check("cobrança não separa mais em duas listas", msgManha.includes("ainda sem baixa"), false);
check("cobrança diz que o cliente aguarda", msgManha.includes("cliente aguardando"), true);

// pacotes lançados à mão, antes de existir bipe no JMS
const codigoNovo = "999999999999999";
const tratsMistas = {
  [codigoNovo]:      { pkgId: codigoNovo, status: "aberta",
                       ticket: { aberto: true, ref: "TT-1" },
                       criadaEm: new Date(Date.now() - 5 * 3600000).toISOString() },
  // este JÁ está na base: não pode aparecer como "aguardando"
  "999881516619685": { pkgId: "999881516619685", status: "aberta",
                       ticket: { aberto: true, ref: "" } },
  // encerrado à mão sem nunca ter sido bipado: some da lista
  "888888888888888": { pkgId: "888888888888888", status: "resolvida" },
};
const espera = aguardandoImportacao(tratsMistas, packages);
check("código sem bipe entra na fila de espera", espera.length, 1);
check("fila de espera aponta o código certo", espera[0]?.pkgId, codigoNovo);
check("pacote já importado não fica esperando",
  espera.some((a) => a.pkgId === "999881516619685"), false);
check("resolvido não fica esperando",
  espera.some((a) => a.pkgId === "888888888888888"), false);
check("lançado à mão já nasce com ticket", espera[0]?.ticketAberto, true);
check("conta as horas de espera", Math.round(espera[0]?.horasEsperando), 5);
// quando o bipe finalmente chega, o motor absorve o ticket e a espera acaba
const comBipe = buildPackages(limpos, { now: agora, tratativas: tratsMistas });
check("ticket lançado antes do bipe vale na importação",
  comBipe.packages.find((p) => p.pkgId === "999881516619685")?.ticketAberto, true);

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
