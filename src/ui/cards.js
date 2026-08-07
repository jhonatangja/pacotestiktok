// ---------------------------------------------------------------------------
// ui/cards.js — o cartão de pacote, unidade visual reutilizada em todas as telas.
//
// Um cartão precisa responder em segundos: qual pacote, em que situação,
// com quem está e há quanto tempo. Nada além disso — o resto é o drawer.
// ---------------------------------------------------------------------------

import { SITUACAO } from "../config.js";
import {
  escapeHtml, TOM, tomVars, duracao, iniciais, flagLabel, flagHint, flagClasse,
} from "./format.js";

/**
 * A idade que interessa é a que a base responde: desde o `bipe de recebimento`.
 * O tempo de trânsito nacional não é responsabilidade daqui — só aparece
 * enquanto o pacote ainda não chegou.
 */
function idade(p) {
  if (p.horasNaBase != null) return `<span>Recebido há <b>${duracao(p.horasNaBase)}</b></span>`;
  if (p.diasDesdeColeta != null) return `<span>Em trânsito · coletado há ${p.diasDesdeColeta}d</span>`;
  return "";
}

export function cardPacote(p) {
  const tom = TOM[p.situacao] ?? "transito";

  // o número que mais importa muda conforme a situação
  const destaque =
    p.situacao === SITUACAO.COM_MOTORISTA_ESTOURADO || p.situacao === SITUACAO.COM_MOTORISTA_NO_PRAZO
      ? `Com o motorista há <b>${duracao(p.horasComMotorista)}</b>`
      : p.situacao === SITUACAO.NA_BASE_NAO_EXPEDIDO
      ? `Na base há <b>${duracao(p.horasAteExpedir)}</b> sem sair`
      : `Parado há <b>${duracao(p.horasSemMovimento)}</b>`;

  const motorista = p.motoristaAtual ?? p.motoristasEnvolvidos[p.motoristasEnvolvidos.length - 1];

  return `
  <button class="pkg ${p.ticketAberto ? "pkg--ticket" : ""}" style="${tomVars(p.ticketAberto ? "atrasado" : tom)}" data-pkg="${escapeHtml(p.pkgId)}">
    <div class="pkg__top">
      <div>
        <div class="pkg__code">${p.ticketAberto ? "🔴 " : ""}${escapeHtml(p.pkgId)}</div>
        <div class="pkg__dest">${escapeHtml(p.destCity ?? "—")}${p.destState ? "/" + escapeHtml(p.destState) : ""}</div>
      </div>
      <span class="pill">${escapeHtml(p.situacaoLabel)}</span>
    </div>

    ${motorista ? `
    <div class="pkg__driver">
      <span class="avatar">${escapeHtml(iniciais(motorista))}</span>
      <span>${escapeHtml(motorista)}</span>
    </div>` : ""}

    <div class="pkg__facts">
      <span>${destaque}</span>
      ${idade(p)}
      ${p.totalDespachos > 1 ? `<span><b>${p.totalDespachos}</b> despachos</span>` : ""}
    </div>

    ${p.flags.length ? `
    <div class="flags">
      ${p.flags.map((f) => `<span class="${flagClasse(f)}" title="${escapeHtml(flagHint(f))}">${escapeHtml(flagLabel(f))}</span>`).join("")}
    </div>` : ""}
  </button>`;
}

export function listaVazia(mensagem, icone = "✓") {
  return `<div class="empty"><span class="empty__icon">${icone}</span><p>${escapeHtml(mensagem)}</p></div>`;
}
