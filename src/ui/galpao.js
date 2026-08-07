// ---------------------------------------------------------------------------
// ui/galpao.js — a fila de tratativas.
//
// Cada pacote que voltou ao galpão é uma tarefa que precisa de dono e prazo.
// A ordenação é pela urgência da TRATATIVA, não pela do pacote: um pacote
// sem responsável está na frente de um pacote velho que já tem alguém cuidando.
// ---------------------------------------------------------------------------

import { SITUACAO } from "../config.js";
import { situacaoTratativa, ordenarFila, STATUS } from "../tratativa.js";
import { escapeHtml, tomVars, duracao, dataHora } from "./format.js";
import { listaVazia } from "./cards.js";

/** Fila de trabalho: só o que ainda não foi encerrado pelo operador. */
export function pacotesDoGalpao(packages) {
  return packages.filter((p) => p.situacao === SITUACAO.RETORNADO_GALPAO && !p.resolvido);
}

export function renderGalpao(el, packages, tratativas) {
  const fila = pacotesDoGalpao(packages);

  if (!fila.length) {
    el.innerHTML = listaVazia("Nenhum pacote no galpão aguardando tratativa.", "🏬");
    return;
  }

  const agora = Date.now();
  const ordenada = ordenarFila(fila, tratativas, agora);

  const semDono = ordenada.filter((p) => {
    const s = situacaoTratativa(tratativas[p.pkgId], agora).estado;
    return s === "SEM_TRATATIVA" || s === "SEM_DONO";
  }).length;
  const vencidas = ordenada.filter((p) =>
    situacaoTratativa(tratativas[p.pkgId], agora).estado === "VENCIDA").length;
  const emAndamento = ordenada.filter((p) =>
    tratativas[p.pkgId]?.status === STATUS.EM_ANDAMENTO).length;

  el.innerHTML = `
    <div class="stats" style="margin-bottom:24px">
      <div class="stat" style="--accent:var(--galpao)">
        <span class="stat__value">${ordenada.length}</span>
        <span class="stat__label">no galpão</span>
      </div>
      <div class="stat" style="--accent:var(--atrasado)">
        <span class="stat__value" style="color:var(--atrasado)">${semDono}</span>
        <span class="stat__label">sem responsável</span>
      </div>
      <div class="stat" style="--accent:var(--atrasado)">
        <span class="stat__value" style="color:var(--atrasado)">${vencidas}</span>
        <span class="stat__label">prazo vencido</span>
      </div>
      <div class="stat" style="--accent:var(--nabase)">
        <span class="stat__value" style="color:var(--nabase)">${emAndamento}</span>
        <span class="stat__label">em andamento</span>
      </div>
    </div>

    <div class="cards">${ordenada.map((p) => cardGalpao(p, tratativas[p.pkgId], agora)).join("")}</div>`;
}

function cardGalpao(p, t, agora) {
  const s = situacaoTratativa(t, agora);
  const motivo = ultimoMotivo(p);

  return `
    <button class="pkg" style="${tomVars(s.tom)}" data-pkg="${escapeHtml(p.pkgId)}">
      <div class="pkg__top">
        <div>
          <div class="pkg__code">${escapeHtml(p.pkgId)}</div>
          <div class="pkg__dest">${escapeHtml(p.destCity ?? "—")}${p.destState ? "/" + escapeHtml(p.destState) : ""}</div>
        </div>
        <span class="pill">${escapeHtml(s.label)}</span>
      </div>

      ${motivo ? `<div class="tl__note" style="margin:0">${escapeHtml(motivo)}</div>` : ""}

      <div class="pkg__facts">
        <span>No galpão há <b>${duracao(p.horasSemMovimento)}</b></span>
        ${t?.responsavel ? `<span>Com <b>${escapeHtml(t.responsavel)}</b></span>` : ""}
        ${t?.prazo ? `<span>Prazo <b>${escapeHtml(formatarPrazo(t.prazo))}</b></span>` : ""}
        ${t?.notas?.length ? `<span><b>${t.notas.length}</b> registro${t.notas.length > 1 ? "s" : ""}</span>` : ""}
      </div>

      ${t?.notas?.length ? `<div class="pkg__dest">Último: ${escapeHtml(t.notas[t.notas.length - 1].texto.slice(0, 80))}</div>` : ""}
    </button>`;
}

/** O motivo pelo qual o pacote voltou — o que a tratativa precisa resolver. */
function ultimoMotivo(p) {
  for (let i = p.timeline.length - 1; i >= 0; i--) {
    const e = p.timeline[i];
    if (e.unshippedType) return e.unshippedType;
    if (e.problemType) return [e.problemType, e.problemDesc].filter(Boolean).join(" — ");
  }
  return null;
}

export function formatarPrazo(iso) {
  if (!iso) return "—";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}`;
}
