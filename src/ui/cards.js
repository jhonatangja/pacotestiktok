// ---------------------------------------------------------------------------
// ui/cards.js — o cartão de pacote, unidade visual reutilizada em todas as telas.
//
// Um cartão precisa responder em segundos: qual pacote, em que situação,
// com quem está e há quanto tempo. Nada além disso — o resto é o drawer.
// ---------------------------------------------------------------------------

import { SITUACAO, BASE_OPERACAO, apelidoDaBase, EMBARCADOR, EMBARCADOR_META } from "../config.js";
import { proximaAcao } from "../acao.js";
import {
  escapeHtml, TOM, tomVars, duracao, dataCurta, prazo, iniciais,
  flagLabel, flagHint, flagClasse,
} from "./format.js";

/**
 * A idade que interessa é a que a base responde: desde o `bipe de recebimento`.
 * O tempo de trânsito nacional não é responsabilidade daqui — só aparece
 * enquanto o pacote ainda não chegou.
 */
function idade(p) {
  // A data de entrada aparece junto do tempo decorrido: "há 7d" responde a
  // urgência, "desde 01/08" é o que se usa para conferir com a planilha e para
  // dizer ao cliente desde quando o pacote está parado aqui.
  if (p.horasNaBase != null) {
    return `<span>No circuito desde <b>${dataCurta(p.recebidoNaBaseEm)}</b> · há <b>${duracao(p.horasNaBase)}</b></span>`;
  }
  if (p.diasDesdeColeta != null) return `<span>Em trânsito · coletado há ${p.diasDesdeColeta}d</span>`;
  return "";
}

/**
 * De qual das nossas bases é a responsabilidade.
 *
 * A base principal fica discreta e a segunda destacada, de propósito: a maioria
 * dos pacotes é da principal, e carimbar todos com o mesmo peso viraria ruído —
 * o que precisa saltar aos olhos é a exceção.
 */
function baseTag(p) {
  if (!p.baseResponsavel) return "";
  const outra = p.baseResponsavel !== BASE_OPERACAO;
  return `<span class="base-tag ${outra ? "base-tag--outra" : ""}"
                title="Responsabilidade de ${escapeHtml(p.baseResponsavel)}${
                  p.transferidoEntreBases ? " — transferido entre bases" : ""}">${
    escapeHtml(apelidoDaBase(p.baseResponsavel))}${p.transferidoEntreBases ? " ⇄" : ""}</span>`;
}

/**
 * De qual embarcador é o pacote. Só aparece quando NÃO é TikTok: a operação é
 * majoritariamente TikTok, e carimbar todos com o mesmo peso viraria ruído.
 */
function embarcadorTag(p) {
  if (!p.embarcador || p.embarcador === EMBARCADOR.TIKTOK) return "";
  const m = EMBARCADOR_META[p.embarcador];
  return `<span class="emb-tag" title="Embarcador: ${escapeHtml(p.embarcadorNome ?? m.label)}">${
    escapeHtml(p.embarcadorNome ?? m.curto)}</span>`;
}

export function cardPacote(p, { comAcao = true } = {}) {
  const tom = TOM[p.situacao] ?? "transito";
  // A ação é a razão do cartão existir: sem ela o operador lê um estado e
  // precisa reconstruir de cabeça o que fazer com ele.
  const acao = comAcao && !p.resolvido ? proximaAcao(p) : null;
  // O prazo com o cliente vale para todo embarcador e é o único número que diz
  // "ainda dá" ou "já falhou" — por isso vem antes da situação.
  const pz = p.resolvido ? null : prazo(p);

  // o número que mais importa muda conforme a situação
  const destaque =
    p.situacao === SITUACAO.COM_MOTORISTA_ESTOURADO || p.situacao === SITUACAO.COM_MOTORISTA_NO_PRAZO
      ? `Com o motorista há <b>${duracao(p.horasComMotorista)}</b>`
      : p.situacao === SITUACAO.EM_TRATATIVA_BASE
      ? `Em tratativa há <b>${duracao(p.horasComMotorista)}</b>`
      : p.situacao === SITUACAO.NA_BASE_NAO_EXPEDIDO
      // O prazo aparece junto porque ele muda com o destino: 18h parado é
      // esquecimento na cidade base e é normal para o interior, que espera a
      // viagem. Sem o prazo ao lado, o mesmo número mente metade das vezes.
      ? `Na base há <b>${duracao(p.horasAteExpedir)}</b> · prazo ${p.slaExpedicaoHoras}h${
          p.atrasadoNaExpedicao ? " <b>estourado</b>" : ""}`
      : `Parado há <b>${duracao(p.horasSemMovimento)}</b>`;

  const motorista = p.motoristaAtual ?? p.motoristasEnvolvidos[p.motoristasEnvolvidos.length - 1];

  return `
  <button class="pkg ${p.ticketAberto ? "pkg--ticket" : ""}" style="${tomVars(p.ticketAberto ? "atrasado" : tom)}" data-pkg="${escapeHtml(p.pkgId)}">
    <div class="pkg__top">
      <div>
        <div class="pkg__code">${p.ticketAberto ? "🔴 " : ""}${escapeHtml(p.pkgId)}${embarcadorTag(p)}</div>
        <div class="pkg__dest">
          ${escapeHtml(p.destCity ?? "—")}${p.destState ? "/" + escapeHtml(p.destState) : ""}
          ${baseTag(p)}
        </div>
      </div>
      <div class="pkg__pills">
        ${pz ? `<span class="pill pill--prazo" style="${tomVars(pz.tom)}">${escapeHtml(pz.texto)}</span>` : ""}
        <span class="pill">${escapeHtml(p.situacaoLabel)}</span>
      </div>
    </div>

    ${motorista ? `
    <div class="pkg__driver${p.naBase ? " pkg__driver--base" : ""}">
      <span class="avatar${p.naBase ? " avatar--base" : ""}">${p.naBase ? "🏠" : escapeHtml(iniciais(motorista))}</span>
      <span>${escapeHtml(motorista)}${p.naBase ? " · tratativa na base" : ""}</span>
    </div>` : ""}

    <div class="pkg__facts">
      <span>${destaque}</span>
      ${idade(p)}
      ${p.totalDespachos > 1 ? `<span><b>${p.totalDespachos}</b> despachos</span>` : ""}
    </div>

    ${acao ? `
    <div class="pkg__acao ${acao.urgente ? "is-urgente" : ""}" style="${tomVars(acao.tom)}">
      <div class="pkg__acao-topo">
        <b>${escapeHtml(acao.titulo)}</b>
        ${acao.dono ? `<span class="pkg__acao-dono">${escapeHtml(acao.dono)}</span>` : ""}
      </div>
      <div class="pkg__acao-detalhe">${escapeHtml(acao.detalhe)}</div>
    </div>` : ""}

    ${p.flags.length ? `
    <div class="flags">
      ${p.flags.map((f) => `<span class="${flagClasse(f)}" title="${escapeHtml(flagHint(f))}">${escapeHtml(flagLabel(f))}</span>`).join("")}
    </div>` : ""}
  </button>`;
}

/**
 * O cartão de um código lançado à mão, antes do primeiro bipe.
 *
 * É deliberadamente pobre: não existe evento nenhum por trás dele, e preencher
 * com dado que não existe seria pior do que mostrar o vazio. O que ele informa
 * é só isto: alguém lançou, faz tanto tempo, e o JMS ainda não confirmou.
 */
export function cardAguardando(a) {
  return `
  <div class="pkg pkg--aguardando ${a.ticketAberto ? "pkg--ticket" : ""}"
       style="${tomVars(a.ticketAberto ? "atrasado" : "transito")}">
    <div class="pkg__top">
      <div>
        <div class="pkg__code">${a.ticketAberto ? "🔴 " : ""}${escapeHtml(a.pkgId)}</div>
        <div class="pkg__dest">Nenhum bipe no JMS ainda</div>
      </div>
      <span class="pill">Aguardando importação</span>
    </div>

    <div class="pkg__facts">
      ${a.horasEsperando != null ? `<span>Lançado há <b>${duracao(a.horasEsperando)}</b></span>` : ""}
      ${a.ticketRef ? `<span>ticket <b>${escapeHtml(a.ticketRef)}</b></span>` : ""}
    </div>

    <div class="pkg__acoes">
      <button class="btn btn--ghost btn--sm" data-remover-aguardando="${escapeHtml(a.pkgId)}">
        Remover
      </button>
    </div>
  </div>`;
}

export function listaVazia(mensagem, icone = "✓") {
  return `<div class="empty"><span class="empty__icon">${icone}</span><p>${escapeHtml(mensagem)}</p></div>`;
}
