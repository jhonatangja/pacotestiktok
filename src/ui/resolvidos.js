// ---------------------------------------------------------------------------
// ui/resolvidos.js — o arquivo dos casos encerrados.
//
// Existe para tirar peso da tela de pendências, não para esconder trabalho:
// tudo aqui continua clicável e volta para a fila com um clique em "Aberta".
//
// Um caso resolvido que receber bipe novo NÃO fica aqui — ele reabre sozinho
// e reaparece nas pendências com a marca "Voltou a se mover". Ver domain.js.
//
// É também a única tela que olha para trás: quanto tempo a operação leva para
// resolver um pacote, do bipe de recebimento até o desfecho.
// ---------------------------------------------------------------------------

import { DESFECHO_META } from "../tratativa.js";
import { escapeHtml, tomVars, duracao, dataCurta, dataHoraLonga, iniciais } from "./format.js";
import { listaVazia } from "./cards.js";

/** Janelas do filtro. `dias: 0` = tudo que já foi encerrado. */
export const PERIODOS = [
  { id: "7",   label: "7 dias",  dias: 7 },
  { id: "30",  label: "30 dias", dias: 30 },
  { id: "",    label: "Tudo",    dias: 0 },
];

const DIA = 86400000;

/** Como o pacote saiu do circuito — inclui a saída automática por outra base. */
function desfechoDe(p) {
  // A assinatura do cliente é o encerramento mais forte que existe, e não veio
  // de decisão de ninguém aqui — vale dizer isso no cartão.
  if (p.entregueEm) {
    return { label: "Entregue ao cliente", icone: "✅", tom: "ok" };
  }
  // Saiu da nossa base por expedição: foi devolvido, não assumido por outro.
  if (p.desfecho === "devolvido_malha") {
    return { label: `Devolvido à malha · ${p.outraBase ?? "malha"}`, icone: "↩️", tom: "nabase" };
  }
  if (p.desfecho === "outra_base") {
    return { label: `Recebido em ${p.outraBase ?? "outra base"}`, icone: "🏢", tom: "nabase" };
  }
  return DESFECHO_META[p.desfecho] ?? { label: "Resolvida", icone: "✅", tom: "ok" };
}

export const pacotesResolvidos = (packages) => packages.filter((p) => p.resolvido);

/** Encerrados dentro da janela escolhida. "" = todos. */
export function doPeriodo(lista, periodo, agora = Date.now()) {
  const dias = PERIODOS.find((p) => p.id === periodo)?.dias ?? 0;
  if (!dias) return lista;
  const limite = agora - dias * DIA;
  return lista.filter((p) => p.resolvidaEm != null && isFinite(p.resolvidaEm) && p.resolvidaEm >= limite);
}

/**
 * Quanto tempo a operação levou para resolver.
 *
 * A mediana anda junto com a média de propósito: um único pacote esquecido por
 * 15 dias puxa a média inteira e faz parecer que a operação toda vai mal. A
 * mediana mostra o caso típico; a distância entre as duas é o tamanho da cauda.
 */
export function tempoDeResolucao(lista) {
  const horas = lista.map((p) => p.horasParaResolver).filter((h) => h != null).sort((a, b) => a - b);
  if (!horas.length) return null;

  const meio = Math.floor(horas.length / 2);
  return {
    n: horas.length,
    media: horas.reduce((s, h) => s + h, 0) / horas.length,
    mediana: horas.length % 2 ? horas[meio] : (horas[meio - 1] + horas[meio]) / 2,
    maisRapido: horas[0],
    maisDemorado: horas[horas.length - 1],
    // o que a operação promete: mesmo dia
    noMesmoDia: horas.filter((h) => h <= 24).length,
  };
}

/** Quantos dos encerrados cumpriram o prazo de entrega combinado. */
export function cumprimentoDoPrazo(lista) {
  const comPrazo = lista.filter((p) => p.entregueNoPrazo != null);
  if (!comPrazo.length) return null;
  const dentro = comPrazo.filter((p) => p.entregueNoPrazo).length;
  return { n: comPrazo.length, dentro, pct: Math.round((dentro / comPrazo.length) * 100) };
}

export function renderResolvidos(el, packages, tratativas, periodo = "") {
  const todos = pacotesResolvidos(packages);

  if (!todos.length) {
    el.innerHTML = listaVazia(
      "Nenhum caso encerrado ainda. Marque uma tratativa como resolvida e ela vem para cá.", "📁");
    return;
  }

  const lista = doPeriodo(todos, periodo)
    .sort((a, b) => (b.resolvidaEm ?? 0) - (a.resolvidaEm ?? 0));

  const t = tempoDeResolucao(lista);
  const cp = cumprimentoDoPrazo(lista);
  const entregues = lista.filter((p) => p.entregueEm).length;
  const semRelogio = lista.length - (t?.n ?? 0);

  el.innerHTML = `
    <div class="basebar" style="margin-bottom:18px">
      <span class="basebar__label">Encerrados em</span>
      ${PERIODOS.map((p) => `
        <button class="basebtn ${periodo === p.id ? "is-on" : ""}" data-periodo="${p.id}">
          ${escapeHtml(p.label)}
          <span class="basebtn__n">${doPeriodo(todos, p.id).length}</span>
        </button>`).join("")}
    </div>

    ${!lista.length ? listaVazia("Nenhum caso encerrado nesse período.", "📁") : `
    <div class="stats" style="margin-bottom:22px">
      <div class="stat" style="--accent:var(--navy)">
        <span class="stat__value">${t ? duracao(t.media) : "—"}</span>
        <span class="stat__label">tempo médio para resolver</span>
      </div>
      <div class="stat" style="--accent:var(--ok)">
        <span class="stat__value" style="color:var(--ok)">${t ? duracao(t.mediana) : "—"}</span>
        <span class="stat__label">tempo típico (mediana)</span>
      </div>
      <div class="stat" style="--accent:var(--atrasado)">
        <span class="stat__value" style="color:var(--atrasado)">${t ? duracao(t.maisDemorado) : "—"}</span>
        <span class="stat__label">o mais demorado</span>
      </div>
      <div class="stat" style="--accent:var(--${cp && cp.pct >= 80 ? "ok" : "atrasado"})">
        <span class="stat__value" style="color:var(--${cp && cp.pct >= 80 ? "ok" : "atrasado"})">${
          cp ? cp.pct + "%" : "—"}</span>
        <span class="stat__label">entregues no prazo${cp ? ` · ${cp.dentro} de ${cp.n}` : ""}</span>
      </div>
      <div class="stat" style="--accent:var(--transito)">
        <span class="stat__value">${lista.length}</span>
        <span class="stat__label">casos encerrados${entregues ? ` · ${entregues} entregues` : ""}</span>
      </div>
    </div>

    <p class="hint" style="margin-bottom:14px">
      O relógio começa no <b>bipe de recebimento</b> na sua base — o tempo de trânsito
      nacional que veio antes não entra na conta.
      ${semRelogio ? `<b>${semRelogio}</b> caso(s) sem recebimento registrado ficaram de fora da média. ` : ""}
      Clique em qualquer pacote para reabrir. Pacote com <b>assinatura do cliente</b> não
      reabre: a baixa é do próprio JMS.
    </p>

    <div class="cards">${lista.map((p) => card(p, tratativas[p.pkgId])).join("")}</div>`}`;
}

// ---------------------------------------------------------------------------

function card(p, t) {
  const notas = t?.notas ?? [];
  const ultima = notas[notas.length - 1];
  const d = desfechoDe(p);

  return `
    <button class="pkg" style="${tomVars(d.tom)}" data-pkg="${escapeHtml(p.pkgId)}">
      <div class="pkg__top">
        <div>
          <div class="pkg__code">${escapeHtml(p.pkgId)}</div>
          <div class="pkg__dest">${escapeHtml(p.destCity ?? "—")}${p.destState ? "/" + escapeHtml(p.destState) : ""}</div>
        </div>
        <span class="pill">${d.icone} ${escapeHtml(d.label)}</span>
      </div>

      ${p.entreguePor || p.responsavelResolucao ? `
      <div class="pkg__driver">
        <span class="avatar">${escapeHtml(iniciais(p.entreguePor ?? p.responsavelResolucao))}</span>
        <span>${escapeHtml(p.entreguePor ?? p.responsavelResolucao)}</span>
      </div>` : ""}

      <div class="pkg__facts">
        ${p.horasParaResolver != null
          ? `<span>Resolvido em <b>${duracao(p.horasParaResolver)}</b></span>`
          : `<span>Sem tempo de resolução apurado</span>`}
        ${p.recebidoNaBaseEm ? `<span>Entrou ${dataCurta(p.recebidoNaBaseEm)}</span>` : ""}
        <span>${p.entregueEm ? "Assinado" : "Encerrado"} ${
          p.resolvidaEm && isFinite(p.resolvidaEm) ? dataHoraLonga(p.resolvidaEm) : "sem data"}</span>
        ${notas.length ? `<span><b>${notas.length}</b> registro${notas.length > 1 ? "s" : ""}</span>` : ""}
      </div>

      ${ultima ? `<div class="pkg__dest">Último: ${escapeHtml(ultima.texto.slice(0, 90))}</div>` : ""}
    </button>`;
}
