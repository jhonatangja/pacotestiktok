// ---------------------------------------------------------------------------
// ui/cobranca.js — a tela de cobrança, organizada por motorista.
//
// A fila é ordenada pelo que dói na operação, não por ordem alfabética:
// rebipe pesa mais que hora parada, e quem tem pacote estourado sobe.
// O registro de "cobrado às HH:MM" é o que impede a mesma cobrança de ser
// feita duas vezes — ou de ser esquecida.
// ---------------------------------------------------------------------------

import { mensagemCobranca, resumoMotorista, atrasados, prazoDaCobranca } from "../charge.js";
import { CORTE_ENTREGA_HOJE } from "../config.js";
import { escapeHtml, tomVars, duracao, dataHora, iniciais } from "./format.js";
import { telefoneValido, formatarTelefone } from "../contatos.js";
import { listaVazia } from "./cards.js";

export function renderCobranca(el, byDriver, selecionado, cobrancas, enrichment = {}, contatos = {}) {
  // Só quem está com pacote na mão agora. Quem já passou adiante não é cobrável
  // — e uma fila com nomes sem pendência faz perder tempo procurando quem falta.
  const comAlgo = byDriver.filter((m) => m.totalAbertos > 0);

  if (!comAlgo.length) {
    el.innerHTML = listaVazia("Nenhum motorista com pacote em aberto. Nada a cobrar agora.", "✅");
    return;
  }

  const atual = comAlgo.find((m) => m.driver === selecionado) ?? comAlgo[0];

  el.innerHTML = `
    <div class="split ${selecionado ? "is-detail" : ""}">
      <div class="split__list">
        ${comAlgo.map((m) => cardMotorista(m, m.driver === atual.driver, cobrancas, contatos)).join("")}
      </div>
      <div class="split__detail">${detalheMotorista(atual, cobrancas, enrichment, contatos)}</div>
    </div>`;
}

// ---------------------------------------------------------------------------

function cardMotorista(m, ativo, cobrancas, contatos) {
  const nAtrasados = atrasados(m);
  const tom = nAtrasados ? "atrasado" : m.totalRebipes ? "ocorrencia" : "ok";
  const ultima = ultimaCobranca(m, cobrancas);
  const temZap = telefoneValido(contatos[m.driver]?.telefone);

  return `
    <button class="driver ${ativo ? "is-active" : ""}" style="${tomVars(tom)}" data-driver="${escapeHtml(m.driver)}">
      <span class="avatar">${escapeHtml(iniciais(m.driver))}</span>
      <span class="driver__body">
        <span class="driver__name">${escapeHtml(m.driver)}${temZap ? ' <span class="driver__zap" title="WhatsApp cadastrado">📱</span>' : ""}</span>
        <span class="driver__meta">${escapeHtml(resumoMotorista(m))}</span>
        ${ultima ? `<span class="driver__charged">cobrado ${dataHora(ultima)}</span>` : ""}
      </span>
      ${m.totalAbertos ? `<span class="pill">${m.totalAbertos}</span>` : ""}
    </button>`;
}

function detalheMotorista(m, cobrancas, enrichment, contatos = {}) {
  const nAtrasados = atrasados(m);
  const telefone = contatos[m.driver]?.telefone ?? "";
  const zapOk = telefoneValido(telefone);

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

    <div class="contact-bar ${zapOk ? "is-set" : ""}">
      <span class="contact-bar__icon">📱</span>
      <input class="input contact-bar__input" id="contatoTelefone" inputmode="tel"
             placeholder="WhatsApp com DDD — ex.: (64) 99999-8888"
             value="${escapeHtml(zapOk ? formatarTelefone(telefone) : telefone)}" />
      <button class="btn btn--ghost" id="btnSalvarContato">Salvar</button>
    </div>

    <div class="detail-body">
      ${linhas.length ? linhas.map(({ d, tipo }) => linhaPacote(d, tipo, enrichment)).join("")
        : `<p style="color:var(--ink-3);font-size:13.5px">Sem pacotes em aberto.</p>`}

      <div class="charge">
        <p class="charge__prazo">${prazoDaCobranca().antesDoCorte
          ? `⏰ Antes das ${CORTE_ENTREGA_HOJE}h — a mensagem vai exigir <b>entrega hoje</b>,
             ou a problemática registrada com a evidência da tentativa de contato.`
          : `⏰ Depois das ${CORTE_ENTREGA_HOJE}h — a mensagem vai pedir para <b>tentar hoje ainda</b> e,
             não dando pelo horário, <b>entregar amanhã logo pela manhã</b>.`}</p>
        <div class="charge__actions">
          <button class="btn btn--primary btn--zap" id="btnCobrarZap" ${zapOk ? "" : "disabled"}>
            📲 Cobrar no WhatsApp
          </button>
          <button class="btn btn--ghost" id="btnGerarCobranca">Ver mensagem</button>
          <button class="btn btn--ghost" id="btnCopiarCobranca" disabled>Copiar</button>
          <span class="hint" id="chargeHint">${zapOk ? "" : "Cadastre o WhatsApp acima para cobrar com um clique."}</span>
        </div>
        <textarea class="charge__text" id="chargeText" readonly hidden
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
