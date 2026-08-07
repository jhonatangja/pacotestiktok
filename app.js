// ---------------------------------------------------------------------------
// app.js — bootstrap, estado e navegação.
//
// Fluxo: repo (eventos crus, append-only) → dedupe → domínio → telas.
// Os eventos são guardados CRUS de propósito: a regra de deduplicação pode
// melhorar sem exigir reimportar nada.
// ---------------------------------------------------------------------------

import { createRepo } from "./src/repo.js";
import { buildEvents, dedupeEvents, mergeEvents, parseWorkbook } from "./src/ingest.js";
import { buildPackages } from "./src/domain.js";
import { SITUACAO_META, SLA_PADRAO } from "./src/config.js";
import { renderPainel, pendencias } from "./src/ui/painel.js";
import { renderPacote } from "./src/ui/pacote.js";
import { renderCobranca } from "./src/ui/cobranca.js";
import { renderGalpao, pacotesDoGalpao } from "./src/ui/galpao.js";
import { renderResolvidos, pacotesResolvidos } from "./src/ui/resolvidos.js";
import { mensagemCobranca } from "./src/charge.js";
import { novaTratativa, adicionarNota, alternarTicket, separarCodigos, STATUS } from "./src/tratativa.js";
import { buildEnrichment } from "./src/enrich.js";
import { codigosParaReconsultar, relatorioCsv, baixar, nomeDoArquivo } from "./src/export.js";
import { cardPacote, listaVazia } from "./src/ui/cards.js";
import { escapeHtml, dataHoraLonga } from "./src/ui/format.js";

const $ = (id) => document.getElementById(id);
const repo = createRepo();

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
  pacoteAberto: null,
};

const el = {
  tabs: $("tabs"), topMeta: $("topMeta"),
  metaPacotes: $("metaPacotes"), metaAtualizado: $("metaAtualizado"),
  telas: {
    importar: $("screenImportar"), painel: $("screenPainel"),
    pacotes: $("screenPacotes"), cobranca: $("screenCobranca"), galpao: $("screenGalpao"),
    resolvidos: $("screenResolvidos"),
  },
  stats: $("stats"), grupos: $("grupos"),
  listaPacotes: $("listaPacotes"), busca: $("buscaPacote"), filtroSituacao: $("filtroSituacao"),
  dropzone: $("dropzone"), dropzoneTitle: $("dropzoneTitle"), fileInput: $("fileInput"),
  importResult: $("importResult"), baseAtual: $("baseAtual"), baseAtualKv: $("baseAtualKv"),
  cobranca: $("cobranca"), galpao: $("galpao"), resolvidos: $("resolvidos"),
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
  state.events = dedupeEvents(state.raw);
  state.cobrancas = (await repo.getMeta("cobrancas", {})) ?? {};
  state.tratativas = Object.fromEntries((await repo.getTreatments()).map((t) => [t.pkgId, t]));
  state.enrichment = Object.fromEntries((await repo.getEnrichment()).map((e) => [e.pkgId, e]));
  // as tratativas entram no motor porque o ticket do cliente reordena a fila
  const r = buildPackages(state.events, { sla: SLA_PADRAO, tratativas: state.tratativas });
  Object.assign(state, { packages: r.packages, byDriver: r.byDriver, resumo: r.resumo });
  renderTudo();
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
  const temDados = state.packages.length > 0;
  el.tabs.hidden = !temDados;
  el.topMeta.hidden = !temDados;

  if (temDados) {
    const ultimo = Math.max(...state.events.map((e) => e.ts));
    el.metaPacotes.textContent = `${state.packages.length} pacotes · ${state.events.length} eventos`;
    el.metaAtualizado.textContent = `último bipe ${dataHoraLonga(ultimo)}`;

    $("countPainel").textContent = pendencias(state.packages).length;
    $("countPacotes").textContent = state.packages.length;
    $("countResolvidos").textContent = pacotesResolvidos(state.packages).length;
    // os contadores mostram o que falta fazer, não o total histórico
    $("countCobranca").textContent = state.byDriver.reduce((s, m) => s + m.totalAbertos, 0);
    $("countGalpao").textContent = pacotesDoGalpao(state.packages).length;
  }

  renderPainel(el, state.packages);
  renderListaPacotes();
  renderCobranca(el.cobranca, state.byDriver, state.motorista, state.cobrancas, state.enrichment);
  renderGalpao(el.galpao, state.packages, state.tratativas);
  renderResolvidos(el.resolvidos, state.packages, state.tratativas);
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
    p, state.tratativas[p.pkgId], state.enrichment[p.pkgId]
  );
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
    await repo.putTreatment({
      ...base,
      status,
      responsavel: $("tratResponsavel")?.value ?? base.responsavel,
      prazo: $("tratPrazo")?.value || null,
    });
    await recarregar();

    if (status === STATUS.RESOLVIDA) {
      fecharPacote();
      toast("Caso encerrado — foi para a aba Resolvidos.", "good");
    } else {
      const p = state.packages.find((x) => x.pkgId === pkgId);
      if (p) desenharDrawer(p);
      toast(`Tratativa marcada como "${opt.textContent.trim()}".`, "good");
    }
    return;
  }

  if (e.target.closest("#btnAddNota")) {
    const campo = $("tratNota");
    if (!campo?.value.trim()) return;
    await salvarTratativa(pkgId, { nota: campo.value });
    toast("Registro adicionado.", "good");
  }
});

// salva responsável e prazo assim que o campo perde o foco
el.drawerBody.addEventListener("change", async (e) => {
  if (!state.pacoteAberto) return;
  if (e.target.id === "tratResponsavel" || e.target.id === "tratPrazo") {
    await salvarTratativa(state.pacoteAberto, {}, false);
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
 * Marca (ou remove) o ticket de vários pacotes de uma vez.
 *
 * Códigos que ainda não foram importados NÃO são descartados: o ticket fica
 * guardado e passa a valer sozinho quando o pacote aparecer numa importação
 * futura. A reclamação do cliente costuma chegar antes do bipe.
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

    (naBase.has(codigo) ? aplicados : guardados).push(codigo);
  }

  await recarregar();
  irPara("painel");

  const verbo = marcar ? "marcado" : "removido";
  const partes = [];
  if (aplicados.length) partes.push({ tom: "atrasado", txt: `${aplicados.length} ${verbo}${aplicados.length > 1 ? "s" : ""}` });
  if (guardados.length) partes.push({ tom: "nabase", txt: `${guardados.length} guardado${guardados.length > 1 ? "s" : ""} para depois` });
  if (semEfeito.length) partes.push({ tom: "transito", txt: `${semEfeito.length} sem alteração` });

  resultadoTickets("ok", `
    <div class="quickbar__tally">
      ${partes.map((p) => `<span style="${tomDe(p.tom)}">${escapeHtml(p.txt)}</span>`).join("")}
    </div>
    ${guardados.length ? `
      <p style="margin-top:9px;color:var(--ink-2)">
        Estes códigos ainda não estão na base — o ticket vale assim que o pacote for importado:
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
  const codigos = codigosParaReconsultar(state.packages, state.tratativas);
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

document.addEventListener("click", (e) => {
  const card = e.target.closest("[data-pkg]");
  if (card) abrirPacote(card.dataset.pkg);
});

// ------------------------------------------------------------------ cobrança
el.cobranca.addEventListener("click", async (e) => {
  const motorista = e.target.closest("[data-driver]");
  if (motorista) {
    state.motorista = motorista.dataset.driver;
    renderCobranca(el.cobranca, state.byDriver, state.motorista, state.cobrancas, state.enrichment);
    return;
  }

  if (e.target.closest("[data-voltar]")) {
    state.motorista = null;
    renderCobranca(el.cobranca, state.byDriver, state.motorista, state.cobrancas, state.enrichment);
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
async function registrarCobranca(m) {
  if (!m) return;
  const em = new Date().toISOString();
  for (const d of m.abertos) state.cobrancas[d.pacote.pkgId] = { em, motorista: m.driver };
  await repo.setMeta("cobrancas", state.cobrancas);

  // o re-render recria o textarea; a mensagem recém-copiada continua na tela
  const msg = $("chargeText")?.value ?? "";
  renderCobranca(el.cobranca, state.byDriver, state.motorista, state.cobrancas, state.enrichment);
  if (msg && $("chargeText")) {
    $("chargeText").value = msg;
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
// INIT
// ---------------------------------------------------------------------------
await recarregar();
irPara(state.packages.length ? "painel" : "importar");
