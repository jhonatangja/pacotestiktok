// ---------------------------------------------------------------------------
// app.js — bootstrap, estado e navegação.
//
// Fluxo: repo (eventos crus, append-only) → dedupe → domínio → telas.
// Os eventos são guardados CRUS de propósito: a regra de deduplicação pode
// melhorar sem exigir reimportar nada.
// ---------------------------------------------------------------------------

import { createRepo } from "./src/repo.js";
import { buildEvents, dedupeEvents, mergeEvents, parseWorkbook, reclassifyEvents } from "./src/ingest.js";
import { buildPackages } from "./src/domain.js";
import { SITUACAO_META, SLA_PADRAO } from "./src/config.js";
import { renderPainel, pendencias } from "./src/ui/painel.js";
import { renderPacote } from "./src/ui/pacote.js";
import { renderCobranca } from "./src/ui/cobranca.js";
import { renderGalpao, pacotesDoGalpao } from "./src/ui/galpao.js";
import { renderResolvidos, pacotesResolvidos } from "./src/ui/resolvidos.js";
import { renderMotoristas, contarMotoristas } from "./src/ui/motoristas.js";
import { renderFechamento, noCircuito, mensagemFechamento } from "./src/ui/fechamento.js";
import { aguardandoImportacao, codigosAguardando } from "./src/aguardando.js";
import { ACAO, definirAutor, novaAtividade, cobradoHoje } from "./src/atividades.js";
import { mensagemCobranca, mensagemFechamentoMotorista } from "./src/charge.js";
import { novaTratativa, adicionarNota, alternarTicket, separarCodigos, STATUS, DESFECHO_META } from "./src/tratativa.js";
import { buildEnrichment } from "./src/enrich.js";
import { codigosParaReconsultar, relatorioCsv, baixar, nomeDoArquivo } from "./src/export.js";
import { cardPacote, listaVazia } from "./src/ui/cards.js";
import { escapeHtml, dataHoraLonga } from "./src/ui/format.js";
import { normalizarTelefone, telefoneValido, linkWhatsApp } from "./src/contatos.js";
import { usarSupabase, usuarioParaEmail, emailParaUsuario } from "./src/supabase-config.js";
import { getSupabaseClient, createSupabaseRepo } from "./src/repo-supabase.js";

const $ = (id) => document.getElementById(id);

// Repositório escolhido no boot: IndexedDB local por padrão, Supabase se
// configurado. É `let` porque o boot pode trocá-lo antes de qualquer uso.
let repo = createRepo();
let sbClient = null;   // cliente Supabase, quando no modo nuvem

const state = {
  raw: [],        // eventos crus vindos do repositório
  events: [],     // deduplicados
  packages: [],
  byDriver: [],
  resumo: {},
  tela: "importar",
  busca: "",
  filtroSituacao: "",
  motorista: null,      // motorista selecionado na tela de cobrança
  cobrancas: {},        // { pkgId: { em, motorista } } — quem já foi cobrado e quando
  tratativas: {},       // { pkgId: tratativa } — dado do usuário, nunca vem do Excel
  enrichment: {},       // { pkgId: dados da Gestão de Bases }
  contatos: {},         // { driver: { telefone } } — cadastrado uma vez, reutilizado
  atividades: [],       // log append-only de quem fez o quê
  aguardando: [],       // códigos lançados à mão, ainda sem bipe no JMS
  buscaMotorista: "",
  pacoteAberto: null,
};

const el = {
  tabs: $("tabs"), topMeta: $("topMeta"),
  metaPacotes: $("metaPacotes"), metaAtualizado: $("metaAtualizado"),
  telas: {
    importar: $("screenImportar"), painel: $("screenPainel"),
    pacotes: $("screenPacotes"), cobranca: $("screenCobranca"), galpao: $("screenGalpao"),
    resolvidos: $("screenResolvidos"), motoristas: $("screenMotoristas"),
    fechamento: $("screenFechamento"),
  },
  stats: $("stats"), grupos: $("grupos"),
  listaPacotes: $("listaPacotes"), busca: $("buscaPacote"), filtroSituacao: $("filtroSituacao"),
  dropzone: $("dropzone"), dropzoneTitle: $("dropzoneTitle"), fileInput: $("fileInput"),
  importResult: $("importResult"), baseAtual: $("baseAtual"), baseAtualKv: $("baseAtualKv"),
  cobranca: $("cobranca"), galpao: $("galpao"), resolvidos: $("resolvidos"),
  motoristas: $("motoristas"), fechamento: $("fechamento"),
  drawerOverlay: $("drawerOverlay"), drawer: $("drawer"), drawerBody: $("drawerBody"),
  drawerTitulo: $("drawerTitulo"), drawerSituacao: $("drawerSituacao"),
  toast: $("toast"),
};

// ---------------------------------------------------------------------------
// TOAST
// ---------------------------------------------------------------------------
let toastTimer = null;
function toast(msg, tipo = "") {
  el.toast.textContent = msg;
  el.toast.className = `toast is-on ${tipo ? "is-" + tipo : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.toast.className = "toast"), 4200);
}

// ---------------------------------------------------------------------------
// DADOS
// ---------------------------------------------------------------------------
async function recarregar() {
  state.raw = await repo.getEvents();
  // reclassifica antes de deduplicar: tipo de bipagem mapeado depois da
  // importação passa a valer sozinho, sem reimportar nada
  state.events = dedupeEvents(reclassifyEvents(state.raw));
  state.cobrancas = (await repo.getMeta("cobrancas", {})) ?? {};
  state.tratativas = Object.fromEntries((await repo.getTreatments()).map((t) => [t.pkgId, t]));
  state.enrichment = Object.fromEntries((await repo.getEnrichment()).map((e) => [e.pkgId, e]));
  state.contatos = Object.fromEntries((await repo.getContacts()).map((c) => [c.driver, c]));
  state.atividades = await repo.getActivities();
  // as tratativas entram no motor porque o ticket do cliente reordena a fila
  const r = buildPackages(state.events, { sla: SLA_PADRAO, tratativas: state.tratativas });
  Object.assign(state, { packages: r.packages, byDriver: r.byDriver, resumo: r.resumo });
  // depende do resultado do motor: só é "aguardando" quem não virou pacote
  state.aguardando = aguardandoImportacao(state.tratativas, state.packages, r.now);
  renderTudo();
}

/**
 * Registra uma ação da equipe no pacote. Append-only: nunca sobrescreve nada,
 * então dois operadores agindo ao mesmo tempo não apagam o registro um do outro.
 */
async function registrar(pkgId, tipo, detalhe = "") {
  const a = novaAtividade(pkgId, tipo, detalhe);
  await repo.putActivity(a);
  state.atividades = [...state.atividades, a];
  return a;
}

async function importar(file) {
  el.dropzone.classList.add("is-busy");
  el.dropzoneTitle.textContent = "Lendo a planilha…";
  try {
    const { headers, rows } = await parseWorkbook(file);
    const { events, unknownTypes, skipped, missing } =
      buildEvents(rows, headers, { sourceFile: file.name });

    if (missing.length) {
      mostrarResultado("erro", `Não encontrei as colunas obrigatórias: <strong>${
        missing.map((m) => escapeHtml(m.header)).join(", ")
      }</strong>. Confira se o arquivo é o export "Consulta de escaneamento por número de pedido" do JMS.`);
      return;
    }
    if (!events.length) {
      mostrarResultado("erro", "Nenhum evento válido encontrado no arquivo.");
      return;
    }

    const antes = await repo.getEvents();
    const { added } = mergeEvents(antes, events);
    await repo.putEvents(events);
    await repo.registrarImportacao({ arquivo: file.name, linhas: rows.length, eventos: events.length, novos: added });

    await recarregar();

    const pacotesNoArquivo = new Set(events.map((e) => e.pkgId)).size;
    mostrarResultado("ok", `
      <strong>${rows.length}</strong> linhas lidas ·
      <strong>${pacotesNoArquivo}</strong> pacotes no arquivo ·
      <strong>${added}</strong> eventos novos${added === 0 ? " (arquivo já importado)" : ""}
      ${skipped ? `<br><span style="opacity:.75">${skipped} linha(s) sem código, data ou tipo foram ignoradas.</span>` : ""}
      ${unknownTypes.length ? `<br><span style="opacity:.75">Tipos de bipagem não mapeados: ${
        unknownTypes.map((u) => `${escapeHtml(u.type)} (${u.count}×)`).join(", ")}</span>` : ""}`);

    toast(`Importado. ${state.packages.length} pacotes na base.`, "good");
    irPara("painel");
  } catch (err) {
    console.error(err);
    mostrarResultado("erro", escapeHtml(err.message ?? "Falha ao importar."));
    toast("Não foi possível importar o arquivo.", "bad");
  } finally {
    el.dropzone.classList.remove("is-busy");
    el.dropzoneTitle.textContent = "Clique ou arraste o arquivo";
    el.fileInput.value = "";
  }
}

function mostrarResultado(tipo, html) {
  el.importResult.hidden = false;
  el.importResult.innerHTML = `<div class="card ${tipo === "ok" ? "card--ok" : "card--warn"}">${html}</div>`;
}

// ---------------------------------------------------------------------------
// RENDER
// ---------------------------------------------------------------------------
function renderTudo() {
  // um código lançado à mão já é motivo para abrir as abas: ele é a única
  // pendência que existe antes de qualquer planilha ser importada
  const temDados = state.packages.length > 0 || state.aguardando.length > 0;
  el.tabs.hidden = !temDados;
  el.topMeta.hidden = !temDados;

  if (temDados) {
    el.metaPacotes.textContent = `${state.packages.length} pacotes · ${state.events.length} eventos`
      + (state.aguardando.length ? ` · ${state.aguardando.length} aguardando` : "");
    el.metaAtualizado.textContent = state.events.length
      ? `último bipe ${dataHoraLonga(Math.max(...state.events.map((e) => e.ts)))}`
      : "nenhum bipe importado ainda";

    $("countPainel").textContent = pendencias(state.packages).length + state.aguardando.length;
    $("countPacotes").textContent = state.packages.length;
    $("countResolvidos").textContent = pacotesResolvidos(state.packages).length;
    // os contadores mostram o que falta fazer, não o total histórico
    $("countCobranca").textContent = state.byDriver.reduce((s, m) => s + m.totalAbertos, 0);
    $("countGalpao").textContent = pacotesDoGalpao(state.packages).length;
    $("countMotoristas").textContent = contarMotoristas(state.packages, state.byDriver, state.contatos);
    // o contador do fechamento mostra o que falta cobrar hoje, não o total
    $("countFechamento").textContent = noCircuito(state.packages)
      .filter((p) => !cobradoHoje(state.atividades, p.pkgId)).length + state.aguardando.length;
  }

  renderPainel(el, state.packages, state.aguardando);
  renderListaPacotes();
  renderCobranca(el.cobranca, state.byDriver, state.motorista, state.cobrancas, state.enrichment, state.contatos);
  renderGalpao(el.galpao, state.packages, state.tratativas);
  renderResolvidos(el.resolvidos, state.packages, state.tratativas);
  renderMotoristas(el.motoristas, state.packages, state.byDriver, state.contatos, state.buscaMotorista);
  renderFechamento(el.fechamento, state.packages, state.byDriver, state.contatos,
                   state.atividades, state.aguardando);
  renderBaseAtual();
}

function renderListaPacotes() {
  if (!el.filtroSituacao.dataset.pronto) {
    el.filtroSituacao.insertAdjacentHTML("beforeend",
      Object.entries(SITUACAO_META)
        .map(([k, m]) => `<option value="${k}">${escapeHtml(m.label)}</option>`).join(""));
    el.filtroSituacao.dataset.pronto = "1";
  }

  const termo = state.busca.trim().toLowerCase();
  const lista = state.packages.filter((p) => {
    if (state.filtroSituacao && p.situacao !== state.filtroSituacao) return false;
    if (!termo) return true;
    return [p.pkgId, p.destCity, ...p.motoristasEnvolvidos]
      .filter(Boolean).some((v) => String(v).toLowerCase().includes(termo));
  });

  el.listaPacotes.innerHTML = lista.length
    ? lista.map(cardPacote).join("")
    : listaVazia("Nenhum pacote corresponde ao filtro.", "🔍");
}

async function renderBaseAtual() {
  if (!state.packages.length) { el.baseAtual.hidden = true; return; }
  const log = (await repo.getMeta("importacoes", [])) ?? [];
  el.baseAtual.hidden = false;
  el.baseAtualKv.innerHTML = `
    <dt>Pacotes</dt><dd>${state.packages.length}</dd>
    <dt>Eventos guardados</dt><dd>${state.raw.length} crus · ${state.events.length} após limpeza</dd>
    <dt>Despachos</dt><dd>${state.resumo.totalDespachos} (${state.resumo.despachosAbertos} abertos)</dd>
    <dt>Importações</dt><dd>${log.length}</dd>
    ${log[0] ? `<dt>Última</dt><dd>${escapeHtml(log[0].arquivo)} · ${dataHoraLonga(new Date(log[0].em).getTime())}</dd>` : ""}`;
}

// ---------------------------------------------------------------------------
// NAVEGAÇÃO
// ---------------------------------------------------------------------------
function irPara(tela) {
  state.tela = tela;
  for (const [nome, node] of Object.entries(el.telas)) node.hidden = nome !== tela;
  document.querySelectorAll(".tab").forEach((t) =>
    t.classList.toggle("is-active", t.dataset.screen === tela));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function abrirPacote(pkgId) {
  const p = state.packages.find((x) => x.pkgId === pkgId);
  if (!p) return;
  state.pacoteAberto = pkgId;
  desenharDrawer(p);
  el.drawerOverlay.hidden = false;
  document.body.style.overflow = "hidden";
}

function desenharDrawer(p) {
  renderPacote(
    { drawer: el.drawer, body: el.drawerBody, titulo: el.drawerTitulo, situacao: el.drawerSituacao },
    p, state.tratativas[p.pkgId], state.enrichment[p.pkgId], state.atividades
  );
}

/** Redesenha o drawer do pacote que está aberto, se houver. */
function desenharDrawerAtual() {
  const p = state.packages.find((x) => x.pkgId === state.pacoteAberto);
  if (p) desenharDrawer(p);
}

function fecharPacote() {
  el.drawerOverlay.hidden = true;
  document.body.style.overflow = "";
  state.pacoteAberto = null;
}

// ----------------------------------------------------------------- tratativa
/** Lê o formulário, grava e redesenha — sem perder o que já estava digitado. */
async function salvarTratativa(pkgId, mudanca, redesenhar = true) {
  const base = state.tratativas[pkgId] ?? novaTratativa(pkgId);
  const responsavel = $("tratResponsavel")?.value ?? base.responsavel;
  const prazo = $("tratPrazo")?.value || null;

  let t = { ...base, responsavel, prazo, ...mudanca };
  if (mudanca?.nota) {
    t = adicionarNota(t, mudanca.nota);
    delete t.nota;
  }

  await repo.putTreatment(t);
  state.tratativas[pkgId] = (await repo.getTreatment(pkgId)) ?? t;

  // Digitar responsável/prazo não redesenha o drawer: refazer o HTML no meio
  // do preenchimento tira o foco do campo seguinte.
  const p = state.packages.find((x) => x.pkgId === pkgId);
  if (p && redesenhar) desenharDrawer(p);
  renderGalpao(el.galpao, state.packages, state.tratativas);
  $("countGalpao").textContent = pacotesDoGalpao(state.packages)
    .filter((x) => state.tratativas[x.pkgId]?.status !== STATUS.RESOLVIDA).length;
}

el.drawerBody.addEventListener("click", async (e) => {
  const pkgId = state.pacoteAberto;
  if (!pkgId) return;

  // O ticket muda a prioridade do pacote, então exige recalcular o motor
  // inteiro — não basta redesenhar o drawer.
  if (e.target.closest("#btnTicket")) {
    const base = state.tratativas[pkgId] ?? novaTratativa(pkgId);
    const t = alternarTicket(base, $("ticketRef")?.value ?? "");
    await repo.putTreatment(t);
    await registrar(pkgId, t.ticket?.aberto ? ACAO.TICKET_ABERTO : ACAO.TICKET_REMOVIDO,
                    t.ticket?.ref ? `ticket ${t.ticket.ref}` : "");
    await recarregar();
    const p = state.packages.find((x) => x.pkgId === pkgId);
    if (p) desenharDrawer(p);
    toast(t.ticket?.aberto
      ? "Ticket marcado — pacote no topo do painel e da cobrança."
      : "Ticket removido.", "good");
    return;
  }

  // O status decide se o pacote sai das pendências e vai para "Resolvidos",
  // então exige recalcular o motor — não basta redesenhar o drawer.
  const opt = e.target.closest("[data-status]");
  if (opt) {
    const status = opt.dataset.status;
    const base = state.tratativas[pkgId] ?? novaTratativa(pkgId);
    const estavaResolvido = base.status === STATUS.RESOLVIDA;
    await repo.putTreatment({
      ...base,
      status,
      desfecho: null,          // voltar a abrir descarta o desfecho anterior
      responsavel: $("tratResponsavel")?.value ?? base.responsavel,
      prazo: $("tratPrazo")?.value || null,
    });
    await registrar(pkgId, estavaResolvido ? ACAO.REABERTO : ACAO.STATUS, opt.textContent.trim());
    await recarregar();

    const p = state.packages.find((x) => x.pkgId === pkgId);
    if (p) desenharDrawer(p);
    toast(estavaResolvido
      ? "Caso reaberto — voltou para as pendências."
      : `Tratativa marcada como "${opt.textContent.trim()}".`, "good");
    return;
  }

  // finalizar: entregue ou devolvido — encerra e manda para Resolvidos
  const fim = e.target.closest("[data-desfecho]");
  if (fim) {
    const desfecho = fim.dataset.desfecho;
    const base = state.tratativas[pkgId] ?? novaTratativa(pkgId);
    await repo.putTreatment({
      ...base,
      status: STATUS.RESOLVIDA,
      desfecho,
      responsavel: $("tratResponsavel")?.value ?? base.responsavel,
      prazo: $("tratPrazo")?.value || null,
    });
    await registrar(pkgId, ACAO.FINALIZADO, DESFECHO_META[desfecho]?.label ?? desfecho);
    await recarregar();
    fecharPacote();
    toast(`Pacote finalizado como "${DESFECHO_META[desfecho]?.label ?? desfecho}" — foi para Resolvidos.`, "good");
    return;
  }

  if (e.target.closest("#btnAddNota")) {
    const campo = $("tratNota");
    if (!campo?.value.trim()) return;
    const texto = campo.value.trim();
    await salvarTratativa(pkgId, { nota: texto });
    await registrar(pkgId, ACAO.NOTA, texto);
    desenharDrawerAtual();
    toast("Registro adicionado.", "good");
  }
});

// salva responsável e prazo assim que o campo perde o foco
el.drawerBody.addEventListener("change", async (e) => {
  if (!state.pacoteAberto) return;
  if (e.target.id === "tratResponsavel" || e.target.id === "tratPrazo") {
    const valor = e.target.value.trim();
    await salvarTratativa(state.pacoteAberto, {}, false);
    if (valor) {
      await registrar(state.pacoteAberto,
        e.target.id === "tratResponsavel" ? ACAO.RESPONSAVEL : ACAO.PRAZO, valor);
    }
    toast("Tratativa salva.", "good");
    return;
  }

  if (e.target.id === "ticketRef") {
    const base = state.tratativas[state.pacoteAberto] ?? novaTratativa(state.pacoteAberto);
    await repo.putTreatment({ ...base, ticket: { ...base.ticket, aberto: true, ref: e.target.value.trim() } });
    state.tratativas[state.pacoteAberto] = await repo.getTreatment(state.pacoteAberto);
    toast("Número do ticket salvo.", "good");
  }
});

el.drawerBody.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.id === "tratNota") { e.preventDefault(); $("btnAddNota")?.click(); }
});

// ---------------------------------------------------------------------------
// EVENTOS DE UI
// ---------------------------------------------------------------------------
el.tabs.addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (tab) irPara(tab.dataset.screen);
});

$("btnIrImportar").addEventListener("click", () => irPara("importar"));

el.fileInput.addEventListener("change", (e) => {
  if (e.target.files?.[0]) importar(e.target.files[0]);
});

["dragenter", "dragover"].forEach((ev) =>
  el.dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    el.dropzone.classList.add("is-over");
  }));
["dragleave", "drop"].forEach((ev) =>
  el.dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    el.dropzone.classList.remove("is-over");
  }));
el.dropzone.addEventListener("drop", (e) => {
  const f = e.dataTransfer?.files?.[0];
  if (f) importar(f);
});

// ------------------------------------------------- tickets em lote (painel)
const bulk = $("ticketBulk");

// cresce conforme a colagem, até o limite do CSS
function ajustarAltura() {
  bulk.style.height = "auto";
  bulk.style.height = Math.min(bulk.scrollHeight, 190) + "px";
}
bulk.addEventListener("input", ajustarAltura);

bulk.addEventListener("keydown", (e) => {
  // Enter lança; Shift+Enter quebra linha
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("btnMarcarTickets").click(); }
});

$("btnMarcarTickets").addEventListener("click", () => aplicarTickets(true));
$("btnRemoverTickets").addEventListener("click", () => aplicarTickets(false));

/**
 * Adiciona (ou remove) pacotes do circuito. Todo código lançado aqui entra como
 * ticket do cliente — é para isso que a caixa existe: o operador só lança à mão
 * o que o cliente reclamou.
 *
 * Códigos que ainda não foram importados NÃO são descartados: viram uma linha
 * em "Aguardando importação" e passam a pacote de verdade sozinhos quando
 * aparecerem numa planilha. A reclamação do cliente costuma chegar antes do bipe.
 */
async function aplicarTickets(marcar) {
  const codigos = separarCodigos(bulk.value);
  if (!codigos.length) {
    resultadoTickets("aviso", "Cole ao menos um código.");
    return;
  }

  const naBase = new Set(state.packages.map((p) => p.pkgId));
  const aplicados = [];
  const semEfeito = [];
  const guardados = [];

  for (const codigo of codigos) {
    const atual = state.tratativas[codigo];
    const jaEsta = !!atual?.ticket?.aberto;
    if (jaEsta === marcar) { semEfeito.push(codigo); continue; }

    const base = atual ?? novaTratativa(codigo);
    await repo.putTreatment({
      ...base,
      ticket: marcar ? { aberto: true, ref: "", em: new Date().toISOString() } : null,
      atualizadaEm: new Date().toISOString(),
    });

    // quem lançou e quando fica no log, igual a qualquer outra ação de operador
    await registrar(codigo, marcar ? ACAO.TICKET_ABERTO : ACAO.TICKET_REMOVIDO,
                    naBase.has(codigo) ? "em lote" : "em lote · antes do primeiro bipe");

    (naBase.has(codigo) ? aplicados : guardados).push(codigo);
  }

  await recarregar();
  irPara("painel");

  const verbo = marcar ? "marcado" : "removido";
  const partes = [];
  if (aplicados.length) partes.push({ tom: "atrasado", txt: `${aplicados.length} ${verbo}${aplicados.length > 1 ? "s" : ""}` });
  if (guardados.length) partes.push({ tom: "nabase", txt: `${guardados.length} aguardando importação` });
  if (semEfeito.length) partes.push({ tom: "transito", txt: `${semEfeito.length} sem alteração` });

  resultadoTickets("ok", `
    <div class="quickbar__tally">
      ${partes.map((p) => `<span style="${tomDe(p.tom)}">${escapeHtml(p.txt)}</span>`).join("")}
    </div>
    ${guardados.length ? `
      <p style="margin-top:9px;color:var(--ink-2)">
        Estes ainda não têm bipe no JMS. Ficam listados em <b>Aguardando importação</b> e viram
        pacote sozinhos na próxima planilha:
      </p>
      <ul>${guardados.map((c) => `<li><code>${escapeHtml(c)}</code></li>`).join("")}</ul>` : ""}`);

  if (aplicados.length || guardados.length) {
    bulk.value = "";
    ajustarAltura();
    toast(`${aplicados.length + guardados.length} ticket(s) ${verbo}(s).`, "good");
  }
}

const tomDe = (t) => `--tone:var(--${t});--tone-bg:var(--${t}-bg);--tone-line:var(--${t}-line)`;

function resultadoTickets(tipo, html) {
  const box = $("ticketBulkResult");
  box.hidden = false;
  box.innerHTML = tipo === "ok" ? html
    : `<span class="hint" style="color:var(--galpao)">${html}</span>`;
}

// ------------------------------------------- Gestão de Bases (enriquecimento)
$("fileInputBase").addEventListener("change", (e) => {
  if (e.target.files?.[0]) importarBase(e.target.files[0]);
});

async function importarBase(file) {
  const zona = $("dropzoneBase");
  const titulo = $("dropzoneBaseTitle");
  zona.classList.add("is-busy");
  titulo.textContent = "Cruzando com os pacotes…";
  try {
    const { headers, rows } = await parseWorkbook(file);
    const { itens, faltaChave, ignoradas } = buildEnrichment(rows, headers);

    if (faltaChave) {
      resultadoBase("erro", "Não encontrei a coluna <strong>Número de pedido JMS</strong> nesse arquivo — sem ela não dá para cruzar com os pacotes.");
      return;
    }

    await repo.putEnrichment(itens);
    await recarregar();

    const casados = itens.filter((i) => state.packages.some((p) => p.pkgId === i.pkgId)).length;
    resultadoBase("ok", `
      <strong>${itens.length}</strong> pedidos lidos ·
      <strong>${casados}</strong> cruzaram com pacotes da sua base
      ${ignoradas ? `<br><span style="opacity:.75">${ignoradas} linha(s) sem código foram ignoradas.</span>` : ""}
      ${casados === 0 ? `<br><span style="opacity:.75">Nenhum código bateu — confira se as duas planilhas são do mesmo período.</span>` : ""}`);
    toast(`Destinatário e endereço disponíveis em ${casados} pacotes.`, "good");
  } catch (err) {
    console.error(err);
    resultadoBase("erro", escapeHtml(err.message ?? "Falha ao ler o arquivo."));
  } finally {
    zona.classList.remove("is-busy");
    titulo.textContent = "Enviar Gestão de Bases";
    $("fileInputBase").value = "";
  }
}

function resultadoBase(tipo, html) {
  const box = $("baseResult");
  box.hidden = false;
  box.innerHTML = `<div class="card ${tipo === "ok" ? "card--ok" : "card--warn"}" style="margin:0">${html}</div>`;
}

// -------------------------------------------------------------- exportações
$("btnCopiarCodigos").addEventListener("click", async () => {
  const codigos = [
    ...codigosAguardando(state.aguardando),
    ...codigosParaReconsultar(state.packages, state.tratativas),
  ];
  if (!codigos.length) { toast("Nenhum código em aberto — nada a reconsultar.", "good"); return; }
  try {
    await navigator.clipboard.writeText(codigos.join("\n"));
    toast(`${codigos.length} códigos copiados — cole na consulta do JMS.`, "good");
  } catch {
    toast("Não foi possível copiar. Baixe o relatório em CSV.", "bad");
  }
});

$("btnBaixarRelatorio").addEventListener("click", () => {
  baixar(nomeDoArquivo("pacotes-tiktok", "csv"),
         relatorioCsv(state.packages, state.tratativas, state.enrichment));
  toast("Relatório gerado.", "good");
});

$("btnLimparBase").addEventListener("click", async () => {
  if (!confirm("Isso apaga todos os eventos importados. As tratativas registradas aqui são preservadas. Confirma?")) return;
  await repo.clearEvents();
  await recarregar();
  el.importResult.hidden = true;
  irPara("importar");
  toast("Histórico de eventos apagado.", "good");
});

document.addEventListener("click", async (e) => {
  // tirar da lista um código lançado à mão (digitado errado, ou resolvido fora
  // do sistema). Só apaga o que nós criamos — não existe evento por trás dele.
  const remover = e.target.closest("[data-remover-aguardando]");
  if (remover) {
    const pkgId = remover.dataset.removerAguardando;
    if (!confirm(`Remover ${pkgId} da lista de aguardando importação?`)) return;
    await repo.deleteTreatment(pkgId);
    await registrar(pkgId, ACAO.TICKET_REMOVIDO, "removido antes de aparecer no JMS");
    await recarregar();
    toast(`${pkgId} removido da lista.`, "good");
    return;
  }

  const card = e.target.closest("[data-pkg]");
  if (card) abrirPacote(card.dataset.pkg);
});

// ------------------------------------------------------------------ cobrança
el.cobranca.addEventListener("click", async (e) => {
  const motorista = e.target.closest("[data-driver]");
  if (motorista) {
    state.motorista = motorista.dataset.driver;
    renderCobranca(el.cobranca, state.byDriver, state.motorista, state.cobrancas, state.enrichment, state.contatos);
    return;
  }

  if (e.target.closest("[data-voltar]")) {
    state.motorista = null;
    renderCobranca(el.cobranca, state.byDriver, state.motorista, state.cobrancas, state.enrichment, state.contatos);
    return;
  }

  // cadastra/atualiza o telefone do motorista selecionado
  if (e.target.closest("#btnSalvarContato")) {
    await salvarContato(motoristaAtual());
    return;
  }

  // a cobrança de um clique: abre o WhatsApp no contato certo, mensagem pronta
  if (e.target.closest("#btnCobrarZap")) {
    const m = motoristaAtual();
    if (!m) return;
    const telefone = state.contatos[m.driver]?.telefone;
    if (!telefoneValido(telefone)) {
      $("chargeHint").textContent = "Cadastre um WhatsApp válido para cobrar com um clique.";
      return;
    }
    const msg = mensagemCobranca(m, state.enrichment);
    if (!msg) { $("chargeHint").textContent = "Nada a cobrar deste motorista."; return; }

    // abre ANTES de qualquer await: alguns navegadores só permitem window.open
    // como consequência direta do clique, não depois de uma promessa resolver
    window.open(linkWhatsApp(telefone, msg), "_blank", "noopener");
    await registrarCobranca(m);
    toast("WhatsApp aberto com a cobrança pronta.", "good");
    return;
  }

  if (e.target.closest("#btnGerarCobranca")) {
    const m = motoristaAtual();
    const msg = m && mensagemCobranca(m, state.enrichment);
    const texto = $("chargeText");
    const hint = $("chargeHint");
    if (!msg) {
      hint.textContent = "Nada a cobrar deste motorista.";
      return;
    }
    texto.value = msg;
    texto.hidden = false;
    $("btnCopiarCobranca").disabled = false;
    hint.textContent = `${m.totalAbertos} em aberto${m.totalRebipes ? ` · ${m.totalRebipes} rebipe(s)` : ""}.`;
    return;
  }

  if (e.target.closest("#btnCopiarCobranca")) {
    const texto = $("chargeText").value;
    if (!texto) return;
    await copiar(texto);
    await registrarCobranca(motoristaAtual());
    toast("Mensagem copiada — cole no WhatsApp.", "good");
  }
});

// Enter no campo de telefone salva sem precisar mirar no botão
el.cobranca.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.id === "contatoTelefone") {
    e.preventDefault();
    salvarContato(motoristaAtual());
  }
});

// ------------------------------------------------- tela de motoristas (banco)
el.motoristas.addEventListener("click", async (e) => {
  // salvar o telefone de um motorista da lista
  const salvar = e.target.closest("[data-salvar]");
  if (salvar) {
    const driver = salvar.dataset.salvar;
    const input = el.motoristas.querySelector(`[data-tel="${cssEscape(driver)}"]`);
    const r = await gravarContato(driver, input?.value ?? "");
    if (!r.ok) { toast(r.msg, "bad"); return; }
    toast(r.msg, "good");
    refazerMotoristas();
    return;
  }

  // remover o contato
  const remover = e.target.closest("[data-remover]");
  if (remover) {
    await gravarContato(remover.dataset.remover, "");
    toast("Contato removido.", "good");
    refazerMotoristas();
    return;
  }

  // cadastrar um motorista novo (nome + telefone), mesmo sem pacote ainda
  if (e.target.closest("#btnAddMotorista")) {
    const nome = $("novoMotoristaNome")?.value.trim().toUpperCase();
    const tel = $("novoMotoristaTel")?.value ?? "";
    if (!nome) { toast("Informe o nome do motorista.", "bad"); return; }
    const r = await gravarContato(nome, tel);
    if (!r.ok) { toast(r.msg, "bad"); return; }
    toast(`Motorista ${nome} cadastrado.`, "good");
    refazerMotoristas();
    return;
  }

  // cobrança de um clique a partir do cadastro
  const zap = e.target.closest("[data-zap]");
  if (zap) {
    const m = state.byDriver.find((x) => x.driver === zap.dataset.zap);
    if (!m || !m.abertos.length) return;
    const tel = state.contatos[m.driver]?.telefone;
    if (!telefoneValido(tel)) { toast("Cadastre um WhatsApp válido primeiro.", "bad"); return; }
    const msg = mensagemCobranca(m, state.enrichment);
    if (!msg) return;
    window.open(linkWhatsApp(tel, msg), "_blank", "noopener");
    await registrarCobranca(m);
    refazerMotoristas();
    toast("WhatsApp aberto com a cobrança pronta.", "good");
  }
});

// Enter salva na linha do motorista ou cadastra o novo
el.motoristas.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  if (e.target.matches("[data-tel]")) {
    e.preventDefault();
    el.motoristas.querySelector(`[data-salvar="${cssEscape(e.target.dataset.tel)}"]`)?.click();
  } else if (e.target.id === "novoMotoristaNome" || e.target.id === "novoMotoristaTel") {
    e.preventDefault();
    $("btnAddMotorista").click();
  }
});

// busca: filtra os cartões já na tela, sem re-render (não perde o foco ao digitar)
el.motoristas.addEventListener("input", (e) => {
  if (e.target.id !== "buscaMotorista") return;
  state.buscaMotorista = e.target.value;
  const termo = e.target.value.trim().toLowerCase();
  el.motoristas.querySelectorAll(".motorista").forEach((card) => {
    card.hidden = termo && !card.dataset.motorista.toLowerCase().includes(termo);
  });
});

// ------------------------------------------------------ fechamento do dia
el.fechamento.addEventListener("click", async (e) => {
  // cobrança de fechamento por motorista: exige atualizar no JMS
  const zap = e.target.closest("[data-fech-zap]");
  if (zap) {
    const nome = zap.dataset.fechZap;
    const m = state.byDriver.find((x) => x.driver === nome);
    const tel = state.contatos[nome]?.telefone;
    if (!m || !telefoneValido(tel)) { toast("Cadastre um WhatsApp válido na aba Motoristas.", "bad"); return; }

    const pacotes = noCircuito(state.packages).filter((p) => p.motoristaAtual === nome);
    const msg = mensagemFechamentoMotorista(m, state.enrichment, pacotes);
    if (!msg) return;

    window.open(linkWhatsApp(tel, msg), "_blank", "noopener");
    await registrarCobranca(m, pacotes);
    renderTudo();
    irPara("fechamento");
    toast(`Cobrança de fechamento enviada para ${nome}.`, "good");
    return;
  }

  // códigos do circuito, um por linha — para colar direto na consulta do JMS
  if (e.target.closest("#btnCopiarCircuito")) {
    // os lançados à mão entram primeiro: consultar o JMS é justamente o que
    // falta para eles virarem pacote
    const codigos = [
      ...codigosAguardando(state.aguardando),
      ...noCircuito(state.packages).map((p) => p.pkgId),
    ];
    if (!codigos.length) { toast("Nenhum pacote no circuito.", "good"); return; }
    try {
      await navigator.clipboard.writeText(codigos.join("\n"));
      toast(`${codigos.length} códigos copiados — cole na consulta do JMS.`, "good");
    } catch {
      toast("Não foi possível copiar. Use o relatório em CSV na aba Importar.", "bad");
    }
    return;
  }

  if (e.target.closest("#btnResumoFechamento")) {
    const msg = mensagemFechamento(state.packages, state.atividades, state.aguardando);
    const ta = $("resumoFechamento");
    if (!msg) { $("fechamentoHint").textContent = "Nada no circuito — nenhum resumo a gerar."; return; }
    ta.value = msg;
    ta.hidden = false;
    $("btnCopiarResumo").disabled = false;
    $("fechamentoHint").textContent =
      `${noCircuito(state.packages).length + state.aguardando.length} pacotes no circuito.`;
    return;
  }

  if (e.target.closest("#btnCopiarResumo")) {
    const ta = $("resumoFechamento");
    if (!ta?.value) return;
    try { await navigator.clipboard.writeText(ta.value); }
    catch { ta.select(); document.execCommand("copy"); }
    toast("Resumo copiado — cole no grupo da operação.", "good");
  }
});

function refazerMotoristas() {
  renderMotoristas(el.motoristas, state.packages, state.byDriver, state.contatos, state.buscaMotorista);
  $("countMotoristas").textContent = contarMotoristas(state.packages, state.byDriver, state.contatos);
}

/** Escapa um valor para uso seguro em seletor de atributo. */
function cssEscape(v) {
  return String(v).replace(/["\\]/g, "\\$&");
}

/**
 * Núcleo de gravação do contato — normaliza, valida, persiste no repositório
 * (local ou nuvem) e atualiza o estado. Usado pela cobrança e pela tela de
 * motoristas. Devolve { ok, msg } para quem chamou decidir o feedback.
 */
async function gravarContato(driver, bruto) {
  if (!driver) return { ok: false };
  const texto = String(bruto ?? "").trim();
  const telefone = normalizarTelefone(texto);

  if (texto && !telefoneValido(telefone)) {
    return { ok: false, msg: "Número fora do padrão. Use DDD + número, ex.: (64) 99999-8888." };
  }
  if (!texto) {
    await repo.deleteContact(driver);
    delete state.contatos[driver];
    return { ok: true, msg: "Contato removido." };
  }
  await repo.putContact({ driver, telefone });
  state.contatos[driver] = { driver, telefone };
  return { ok: true, msg: "WhatsApp salvo." };
}

/** Salva o contato na barra da tela de cobrança. */
async function salvarContato(m) {
  if (!m) return;
  const r = await gravarContato(m.driver, $("contatoTelefone")?.value ?? "");
  if (!r.ok) { $("chargeHint").textContent = r.msg; return; }
  toast(r.msg, "good");
  renderCobranca(el.cobranca, state.byDriver, state.motorista, state.cobrancas, state.enrichment, state.contatos);
}

function motoristaAtual() {
  const comAlgo = state.byDriver.filter((m) => m.totalAbertos || m.totalRebipes || m.ocorrenciasLentas.length);
  return comAlgo.find((m) => m.driver === state.motorista) ?? comAlgo[0] ?? null;
}

async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
  } catch {
    const ta = $("chargeText");
    ta.select();
    document.execCommand("copy");
  }
}

/**
 * Marca os pacotes deste motorista como cobrados agora. É isso que evita
 * cobrar duas vezes a mesma coisa — e que mostra quem ficou sem cobrança.
 */
async function registrarCobranca(m, pacotes = null) {
  if (!m) return;
  const em = new Date().toISOString();
  const lista = pacotes ?? m.abertos.map((d) => d.pacote);
  for (const p of lista) {
    state.cobrancas[p.pkgId] = { em, motorista: m.driver };
    // além do carimbo, entra no log com autor — é o que permite auditar depois
    await registrar(p.pkgId, ACAO.COBRANCA, m.driver);
  }
  await repo.setMeta("cobrancas", state.cobrancas);

  // o re-render recria o textarea; a mensagem recém-copiada continua na tela
  const msg = $("chargeText")?.value ?? "";
  renderCobranca(el.cobranca, state.byDriver, state.motorista, state.cobrancas, state.enrichment, state.contatos);
  if (msg && $("chargeText")) {
    $("chargeText").value = msg;
    $("chargeText").hidden = false;
    $("btnCopiarCobranca").disabled = false;
    $("chargeHint").textContent = "Cobrança registrada agora.";
  }
}

$("btnFecharDrawer").addEventListener("click", fecharPacote);
el.drawerOverlay.addEventListener("click", (e) => {
  if (e.target === el.drawerOverlay) fecharPacote();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !el.drawerOverlay.hidden) fecharPacote();
});

el.busca.addEventListener("input", (e) => { state.busca = e.target.value; renderListaPacotes(); });
el.filtroSituacao.addEventListener("change", (e) => { state.filtroSituacao = e.target.value; renderListaPacotes(); });

// ---------------------------------------------------------------------------
// MODO NUVEM (Supabase) — login e tempo real
// ---------------------------------------------------------------------------

/** Garante uma sessão logada antes de liberar o app. Mostra o login se preciso. */
async function garantirLogin(client) {
  const { data: { session } } = await client.auth.getSession();
  if (session) return session;

  return new Promise((resolve) => {
    const overlay = $("loginOverlay");
    overlay.hidden = false;
    $("loginUsuario").focus();

    $("loginForm").onsubmit = async (e) => {
      e.preventDefault();
      const erro = $("loginErro");
      const btn = $("btnLogin");
      erro.textContent = "";
      btn.disabled = true;
      btn.textContent = "Entrando…";
      // o operador digita só o usuário; o e-mail interno é montado aqui
      const { data, error } = await client.auth.signInWithPassword({
        email: usuarioParaEmail($("loginUsuario").value),
        password: $("loginSenha").value,
      });
      btn.disabled = false;
      btn.textContent = "Entrar";
      if (error) {
        erro.textContent = "Usuário ou senha incorretos.";
        return;
      }
      overlay.hidden = true;
      resolve(data.session);
    };
  });
}

// Recarrega a tela quando outro operador altera a base — mas espera o usuário
// parar de digitar, para não apagar um campo no meio do preenchimento.
let realtimeTimer = null;
function agendarReloadTempoReal() {
  clearTimeout(realtimeTimer);
  realtimeTimer = setTimeout(async () => {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return agendarReloadTempoReal();
    await recarregar();
    toast("Base atualizada em tempo real.", "");
  }, 800);
}

function mostrarBarraNuvem(session) {
  const barra = $("cloudStatus");
  if (!barra) return;
  barra.hidden = false;
  $("cloudEmail").textContent = emailParaUsuario(session?.user?.email) || "conectado";
}

$("btnLogout")?.addEventListener("click", async () => {
  if (!sbClient) return;
  await sbClient.auth.signOut();
  location.reload();
});

// ---------------------------------------------------------------------------
// INIT
// ---------------------------------------------------------------------------
async function boot() {
  if (usarSupabase()) {
    try {
      sbClient = await getSupabaseClient();
      const session = await garantirLogin(sbClient);
      repo = createSupabaseRepo(sbClient);
      repo.subscribe(() => agendarReloadTempoReal());
      mostrarBarraNuvem(session);
      // a partir daqui toda ação registrada leva o nome de quem está logado
      definirAutor(emailParaUsuario(session?.user?.email));
    } catch (err) {
      console.error(err);
      toast("Não foi possível conectar à nuvem. Usando a base local desta máquina.", "bad");
      repo = createRepo();   // fallback: não trava o operador se a nuvem cair
    }
  }
  await recarregar();
  irPara(state.packages.length ? "painel" : "importar");
}

boot();
