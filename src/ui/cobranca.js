// ---------------------------------------------------------------------------
// ui/cobranca.js — a tela de cobrança, organizada por motorista.
//
// A fila é ordenada pelo que dói na operação, não por ordem alfabética:
// rebipe pesa mais que hora parada, e quem tem pacote estourado sobe.
// O registro de "cobrado às HH:MM" é o que impede a mesma cobrança de ser
// feita duas vezes — ou de ser esquecida.
// ---------------------------------------------------------------------------

import { mensagemCobranca, resumoMotorista, atrasados } from "../charge.js";
import { escapeHtml, tomVars, duracao, dataHora, iniciais } from "./format.js";
import { listaVazia } from "./cards.js";

export function renderCobranca(el, byDriver, selecionado, cobrancas, enrichment = {}) {
  const comAlgo = byDriver.filter((m) => m.totalAbertos || m.totalRebipes || m.ocorrenciasLentas.length);

  if (!comAlgo.length) {
    el.innerHTML = listaVazia("Nenhum motorista com pacote em aberto. Nada a cobrar agora.", "✅");
    return;
  }

  const atual = comAlgo.find((m) => m.driver === selecionado) ?? comAlgo[0];

  el.innerHTML = `
    <div class="split ${selecionado ? "is-detail" : ""}">
      <div class="split__list">
        ${comAlgo.map((m) => cardMotorista(m, m.driver === atual.driver, cobrancas)).join("")}
      </div>
      <div class="split__detail">${detalheMotorista(atual, cobrancas, enrichment)}</div>
    </div>`;
}

// ---------------------------------------------------------------------------

function cardMotorista(m, ativo, cobrancas) {
  const nAtrasados = atrasados(m);
  const tom = nAtrasados ? "atrasado" : m.totalRebipes ? "ocorrencia" : "ok";
  const ultima = ultimaCobranca(m, cobrancas);

  return `
    <button class="driver ${ativo ? "is-active" : ""}" style="${tomVars(tom)}" data-driver="${escapeHtml(m.driver)}">
      <span class="avatar">${escapeHtml(iniciais(m.driver))}</span>
      <span class="driver__body">
        <span class="driver__name">${escapeHtml(m.driver)}</span>
        <span class="driver__meta">${escapeHtml(resumoMotorista(m))}</span>
        ${ultima ? `<span class="driver__charged">cobrado ${dataHora(ultima)}</span>` : ""}
      </span>
      ${m.totalAbertos ? `<span class="pill">${m.totalAbertos}</span>` : ""}
    </button>`;
}

function detalheMotorista(m, cobrancas, enrichment) {
  const nAtrasados = atrasados(m);

  // ticket na frente, depois quem estourou o prazo, depois o resto
  const ordenados = [...m.abertos].sort((a, b) =>
    (b.pacote.ticketAberto - a.pacote.ticketAberto) ||
    (b.estourado - a.estourado) || (b.horasPosse - a.horasPosse));

  const linhas = [
    ...ordenados.map((d) => ({ d, tipo: "aberto" })),
    ...m.rebipes.map((d) => ({ d, tipo: "rebipe" })),
  ];

  return `
    <div class="detail-head">
      <button class="icon-btn voltar" data-voltar aria-label="Voltar">←</button>
      <div>
        <span class="eyebrow">Motorista</span>
        <h2>${escapeHtml(m.driver)}</h2>
      </div>
      <div class="detail-head__chips">
        ${m.totalTickets ? `<span class="pill" style="${tomVars("atrasado")}">🔴 ${m.totalTickets} com ticket</span>` : ""}
        ${m.totalAbertos ? `<span class="pill" style="${tomVars(nAtrasados ? "atrasado" : "ok")}">${m.totalAbertos} em aberto</span>` : ""}
        ${nAtrasados ? `<span class="pill" style="${tomVars("atrasado")}">${nAtrasados} fora do prazo</span>` : ""}
        ${m.totalRebipes ? `<span class="pill" style="${tomVars("ocorrencia")}">${m.totalRebipes} rebipe${m.totalRebipes > 1 ? "s" : ""}</span>` : ""}
      </div>
    </div>

    <div class="detail-body">
      ${linhas.length ? linhas.map(({ d, tipo }) => linhaPacote(d, tipo, enrichment)).join("")
        : `<p style="color:var(--ink-3);font-size:13.5px">Sem pacotes em aberto.</p>`}

      <div class="charge">
        <div class="charge__actions">
          <button class="btn btn--primary" id="btnGerarCobranca">Gerar cobrança</button>
          <button class="btn btn--ghost" id="btnCopiarCobranca" disabled>Copiar mensagem</button>
          <span class="hint" id="chargeHint"></span>
        </div>
        <textarea class="charge__text" id="chargeText" readonly
                  placeholder="A mensagem aparecerá aqui, pronta para colar no WhatsApp."></textarea>
      </div>
    </div>`;
}

function linhaPacote(d, tipo, enrichment = {}) {
  const p = d.pacote;
  const e = enrichment[p.pkgId];
  const tom = p.ticketAberto ? "atrasado" : tipo === "rebipe" ? "ocorrencia" : d.estourado ? "atrasado" : "ok";
  const nota = tipo === "rebipe"
    ? `Ficou <b>${duracao(d.horasPosse)}</b> sem baixa e o pacote saiu de novo`
    : `Com o motorista há <b>${duracao(d.horasPosse)}</b>${d.estourado ? " — fora do prazo" : ""}`;

  // com a Gestão de Bases importada, a linha já identifica o cliente —
  // o operador não precisa abrir o pacote para saber de quem se trata
  const quem = e?.destinatario ?? p.destCity ?? "—";

  return `
    <button class="charge-row" style="${tomVars(tom)}" data-pkg="${escapeHtml(p.pkgId)}">
      <span class="charge-row__code">${p.ticketAberto ? "🔴 " : ""}${escapeHtml(p.pkgId)}</span>
      <span class="charge-row__dest">${escapeHtml(quem)}</span>
      <span class="charge-row__note">${nota}</span>
      <span class="charge-row__when">${e?.bairro ? escapeHtml(e.bairro) + " · " : ""}saiu ${dataHora(d.startedAt)}</span>
    </button>`;
}

function ultimaCobranca(m, cobrancas) {
  const ts = m.abertos
    .map((d) => cobrancas?.[d.pacote.pkgId]?.em)
    .filter(Boolean)
    .map((iso) => new Date(iso).getTime());
  return ts.length ? Math.max(...ts) : null;
}

export { mensagemCobranca };
