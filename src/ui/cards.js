// ---------------------------------------------------------------------------
// ui/cards.js — o cartão de pacote, unidade visual reutilizada em todas as telas.
//
// Um cartão precisa responder em segundos: qual pacote, em que situação,
// com quem está e há quanto tempo. Nada além disso — o resto é o drawer.
// ---------------------------------------------------------------------------

import {
  SITUACAO, BASE_OPERACAO, apelidoDaBase, EMBARCADOR, EMBARCADOR_META, FLAG,
} from "../config.js";
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
  // Só a DATA. O "há quanto tempo" saiu daqui porque o chip de prazo já
  // responde isso, e melhor: ele diz se ainda dá tempo. Ter os dois no mesmo
  // cartão era o terceiro relógio para o mesmo pacote.
  if (p.recebidoNaBaseEm != null) {
    return `<span>Desde <b>${dataCurta(p.recebidoNaBaseEm)}</b></span>`;
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

/**
 * Flags são HISTÓRICO — o que já aconteceu. A ação logo acima é o presente, e
 * quatro chips coloridos tinham mais peso visual do que ela. Só as graves
 * aparecem por extenso; o resto vira um contador que o drawer detalha.
 *
 * `PRAZO_ESTOURADO` fica de fora: o chip de prazo já diz isso, mais alto.
 */
function flagsDoCartao(p) {
  const mostrar = p.flags.filter((f) => f !== FLAG.PRAZO_ESTOURADO);
  if (!mostrar.length) return "";

  const graves = mostrar.filter((f) => flagClasse(f) === "flag");
  const resto = mostrar.filter((f) => flagClasse(f) !== "flag");

  return `
    <div class="flags">
      ${graves.map((f) => `<span class="flag" title="${escapeHtml(flagHint(f))}">${escapeHtml(flagLabel(f))}</span>`).join("")}
      ${resto.length ? `<span class="flag flag--mute" title="${
        escapeHtml(resto.map(flagLabel).join(" · "))}">+${resto.length}</span>` : ""}
    </div>`;
}

/**
 * Ação, prazo e a cor que resulta dos dois — compartilhado entre o cartão e a
 * linha compacta, para as duas formas nunca contarem histórias diferentes do
 * mesmo pacote.
 */
function acaoPrazoETom(p, comAcao) {
  // A ação é a razão do cartão existir: sem ela o operador lê um estado e
  // precisa reconstruir de cabeça o que fazer com ele.
  const acao = comAcao && !p.resolvido ? proximaAcao(p) : null;
  // O prazo com o cliente vale para todo embarcador e é o único número que diz
  // "ainda dá" ou "já falhou" — por isso é o único chip do cartão.
  const pz = p.resolvido ? null : prazo(p);
  // A cor é a URGÊNCIA, não só a situação. Sem isso um pacote com prazo vencido
  // e motorista "no prazo" ganhava borda verde e chip vermelho ao mesmo tempo —
  // dois sinais opostos sobre o mesmo pacote.
  const tom = p.ticketAberto || pz?.estourado ? "atrasado" : (TOM[p.situacao] ?? "transito");
  return { acao, pz, tom };
}

export function cardPacote(p, { comAcao = true } = {}) {
  const { acao, pz, tom } = acaoPrazoETom(p, comAcao);

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
  // Quando o dono da ação É o motorista — os dois maiores grupos do painel —,
  // o nome saía duas vezes no mesmo cartão, com dois tratamentos diferentes.
  // Uma linha só, dentro da ação, responde "quem é o dono disso" de uma vez.
  const donoEhOMotorista = !!acao?.dono && acao.dono === motorista;

  return `
  <button class="pkg ${p.ticketAberto ? "pkg--ticket" : ""}" style="${tomVars(tom)}" data-pkg="${escapeHtml(p.pkgId)}">
    <div class="pkg__top">
      <div>
        <div class="pkg__code">${p.ticketAberto ? "🔴 " : ""}${escapeHtml(p.pkgId)}${embarcadorTag(p)}</div>
        <div class="pkg__dest">
          ${escapeHtml(p.destCity ?? "—")}${p.destState ? "/" + escapeHtml(p.destState) : ""}
          ${baseTag(p)}
        </div>
      </div>
      ${pz
        ? `<span class="pill pill--prazo" style="${tomVars(pz.tom)}">${escapeHtml(pz.texto)}</span>`
        : `<span class="pill">${escapeHtml(p.situacaoLabel)}</span>`}
    </div>

    ${motorista && !donoEhOMotorista ? `
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
        ${acao.dono ? `<span class="pkg__acao-dono">${
          donoEhOMotorista ? `<span class="avatar avatar--mini">${escapeHtml(iniciais(acao.dono))}</span>` : ""
        }${escapeHtml(acao.dono)}</span>` : ""}
      </div>
      <div class="pkg__acao-detalhe">${escapeHtml(acao.detalhe)}</div>
    </div>` : ""}

    ${flagsDoCartao(p)}
  </button>`;
}

/**
 * A mesma informação do cartão, numa linha — para telas com muitos pacotes de
 * uma vez (Painel de Ação, TikTok Shop, Todos os pacotes), onde o cartão
 * inteiro por item faz a lista virar uma rolagem sem fim.
 *
 * O que sobrevive à compressão: código, destino, prazo e a ação — o resto
 * (motorista quando não é o dono da ação, contagem de despachos, flags por
 * extenso) fica só no drawer. Clicar na linha abre exatamente o mesmo drawer
 * do cartão — é o `data-pkg` que faz isso, não JS novo.
 */
export function linhaPacote(p, { comAcao = true } = {}) {
  const { acao, pz, tom } = acaoPrazoETom(p, comAcao);

  const motorista = p.motoristaAtual ?? p.motoristasEnvolvidos[p.motoristasEnvolvidos.length - 1];
  const donoEhOMotorista = !!acao?.dono && acao.dono === motorista;
  // Sem ação (resolvido, ou em trânsito) a linha ainda precisa dizer alguma
  // coisa no lugar dela — cai para a situação, que é o que resta a informar.
  const donoParaMostrar = acao?.dono ?? (!donoEhOMotorista ? motorista : null);

  const flags = p.flags.filter((f) => f !== FLAG.PRAZO_ESTOURADO);

  return `
  <button class="pkgrow ${p.ticketAberto ? "pkgrow--ticket" : ""}" style="${tomVars(tom)}" data-pkg="${escapeHtml(p.pkgId)}">
    <div class="pkgrow__id">
      <span class="pkgrow__code">${p.ticketAberto ? "🔴 " : ""}${escapeHtml(p.pkgId)}${embarcadorTag(p)}</span>
      <span class="pkgrow__dest">${escapeHtml(p.destCity ?? "—")}${p.destState ? "/" + escapeHtml(p.destState) : ""}${baseTag(p)}</span>
    </div>

    <div class="pkgrow__acao">
      <b style="${acao ? `color:var(--${acao.tom})` : ""}">${escapeHtml(acao?.titulo ?? p.situacaoLabel)}</b>
      ${donoParaMostrar ? `<span class="pkgrow__dono">${escapeHtml(donoParaMostrar)}</span>` : ""}
      ${flags.length ? `<span class="pkgrow__flags" title="${escapeHtml(flags.map(flagLabel).join(" · "))}">🚩${flags.length}</span>` : ""}
    </div>

    ${pz
      ? `<span class="pill pill--prazo pkgrow__prazo" style="${tomVars(pz.tom)}">${escapeHtml(pz.texto)}</span>`
      : `<span class="pill pkgrow__prazo">${escapeHtml(p.situacaoLabel)}</span>`}
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
