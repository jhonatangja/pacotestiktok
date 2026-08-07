// ---------------------------------------------------------------------------
// ui/resolvidos.js — o arquivo dos casos encerrados.
//
// Existe para tirar peso da tela de pendências, não para esconder trabalho:
// tudo aqui continua clicável e volta para a fila com um clique em "Aberta".
//
// Um caso resolvido que receber bipe novo NÃO fica aqui — ele reabre sozinho
// e reaparece nas pendências com a marca "Voltou a se mover". Ver domain.js.
// ---------------------------------------------------------------------------

import { escapeHtml, tomVars, duracao, dataHoraLonga, iniciais } from "./format.js";
import { listaVazia } from "./cards.js";

export const pacotesResolvidos = (packages) => packages.filter((p) => p.resolvido);

export function renderResolvidos(el, packages, tratativas) {
  const lista = pacotesResolvidos(packages)
    .sort((a, b) => (b.resolvidaEm ?? 0) - (a.resolvidaEm ?? 0));

  if (!lista.length) {
    el.innerHTML = listaVazia(
      "Nenhum caso encerrado ainda. Marque uma tratativa como resolvida e ela vem para cá.", "📁");
    return;
  }

  const comDono = lista.filter((p) => p.responsavelResolucao).length;

  el.innerHTML = `
    <div class="stats" style="margin-bottom:22px">
      <div class="stat" style="--accent:var(--ok)">
        <span class="stat__value" style="color:var(--ok)">${lista.length}</span>
        <span class="stat__label">casos encerrados</span>
      </div>
      <div class="stat" style="--accent:var(--transito)">
        <span class="stat__value">${comDono}</span>
        <span class="stat__label">com responsável registrado</span>
      </div>
    </div>

    <p class="hint" style="margin-bottom:14px">
      Clique em qualquer pacote para reabrir — basta voltar o status para "Aberta".
      Se um pacote resolvido receber bipe novo, ele volta sozinho para as pendências.
    </p>

    <div class="cards">${lista.map((p) => card(p, tratativas[p.pkgId])).join("")}</div>`;
}

function card(p, t) {
  const notas = t?.notas ?? [];
  const ultima = notas[notas.length - 1];

  return `
    <button class="pkg" style="${tomVars("ok")}" data-pkg="${escapeHtml(p.pkgId)}">
      <div class="pkg__top">
        <div>
          <div class="pkg__code">${escapeHtml(p.pkgId)}</div>
          <div class="pkg__dest">${escapeHtml(p.destCity ?? "—")}${p.destState ? "/" + escapeHtml(p.destState) : ""}</div>
        </div>
        <span class="pill">Resolvida</span>
      </div>

      ${p.responsavelResolucao ? `
      <div class="pkg__driver">
        <span class="avatar">${escapeHtml(iniciais(p.responsavelResolucao))}</span>
        <span>${escapeHtml(p.responsavelResolucao)}</span>
      </div>` : ""}

      <div class="pkg__facts">
        <span>Encerrado ${p.resolvidaEm && isFinite(p.resolvidaEm) ? "em " + dataHoraLonga(p.resolvidaEm) : "sem data"}</span>
        <span>Era: <b>${escapeHtml(p.situacaoLabel)}</b></span>
        ${notas.length ? `<span><b>${notas.length}</b> registro${notas.length > 1 ? "s" : ""}</span>` : ""}
      </div>

      ${ultima ? `<div class="pkg__dest">Último: ${escapeHtml(ultima.texto.slice(0, 90))}</div>` : ""}
    </button>`;
}
