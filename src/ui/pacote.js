// ---------------------------------------------------------------------------
// ui/pacote.js — o drawer de detalhe.
//
// Mostra o que 20 e poucas linhas de Excel escondiam: a cadeia de posse
// (quem pegou, quando, e como terminou) e a timeline já limpa de bipes
// duplicados. É a tela que responde "por que este pacote está atrasado?".
// ---------------------------------------------------------------------------

import { FACT } from "../config.js";
import { STATUS, STATUS_META, DESFECHO, DESFECHO_META, situacaoTratativa } from "../tratativa.js";
import { ACAO_META, doPacote } from "../atividades.js";
import { formatarValor, enderecoCompleto } from "../enrich.js";
import {
  escapeHtml, TOM, tomVars, duracao, dataHora, dataHoraLonga, iniciais,
  flagLabel, flagHint, flagClasse, desfecho, FATO_QUENTE, TOM_DO_FATO,
} from "./format.js";

export function renderPacote(el, p, tratativa, dadosCliente, atividades = []) {
  const tom = TOM[p.situacao] ?? "transito";

  el.situacao.textContent = `${p.situacaoLabel} · ${p.acao}`;
  el.titulo.textContent = p.pkgId;
  el.drawer.setAttribute("style", tomVars(tom));

  el.body.innerHTML = `
    ${blocoTicket(p, tratativa)}

    ${p.flags.length ? `<div class="flags" style="margin-bottom:18px">
      ${p.flags.map((f) => `<span class="${flagClasse(f)}" title="${escapeHtml(flagHint(f))}">${escapeHtml(flagLabel(f))}</span>`).join("")}
    </div>` : ""}

    ${secaoTratativa(p, tratativa)}
    ${secaoCliente(dadosCliente)}

    <div class="drawer__section">
      <h3>Resumo</h3>
      <dl class="kv">
        <dt>Destino</dt><dd>${escapeHtml(p.destCity ?? "—")}${p.destState ? "/" + escapeHtml(p.destState) : ""}${p.destZip ? ` · ${escapeHtml(p.destZip)}` : ""}</dd>
        <dt>Origem</dt><dd>${escapeHtml(p.originBase ?? "—")}</dd>
        ${p.coletadoEm ? `<dt>Coletado</dt><dd>${dataHoraLonga(p.coletadoEm)} · há ${p.diasDesdeColeta}d</dd>` : ""}
        ${p.recebidoNaBaseEm ? `<dt>Recebido na base</dt><dd>${dataHoraLonga(p.recebidoNaBaseEm)} · há ${duracao(p.horasNaBase)}</dd>` : ""}
        ${p.horasAteExpedir != null ? `<dt>Levou para expedir</dt><dd>${duracao(p.horasAteExpedir)}</dd>` : ""}
        <dt>Último bipe</dt><dd>${escapeHtml(p.ultimoEvento)} · ${dataHoraLonga(p.ultimoEventoEm)}</dd>
        <dt>Parado há</dt><dd>${duracao(p.horasSemMovimento)}</dd>
      </dl>
    </div>

    <div class="drawer__section">
      <h3>Cadeia de posse — ${p.totalDespachos} despacho${p.totalDespachos === 1 ? "" : "s"}</h3>
      ${p.despachos.length
        ? p.despachos.map(cardDespacho).join("")
        : `<p style="color:var(--ink-3);font-size:13.5px">Nunca saiu para entrega.</p>`}
    </div>

    ${secaoAtividades(p, atividades)}

    <div class="drawer__section">
      <h3>Histórico completo do JMS</h3>
      <div class="timeline">${p.timeline.map(itemTimeline).join("")}</div>
    </div>`;
}

/**
 * O que a EQUIPE fez neste pacote — separado da timeline do JMS, que é
 * máquina bipando. Aqui é gente: quem cobrou, quem assumiu, quem finalizou.
 */
function secaoAtividades(p, atividades) {
  const lista = doPacote(atividades, p.pkgId);

  return `
    <div class="drawer__section">
      <h3>Ações da equipe ${lista.length ? `<span class="trat__state">${lista.length}</span>` : ""}</h3>
      ${lista.length ? `
      <ol class="acoes">
        ${lista.map((a) => {
          const meta = ACAO_META[a.tipo] ?? { label: a.tipo, icone: "•", tom: "transito" };
          return `
          <li class="acao" style="${tomVars(meta.tom)}">
            <span class="acao__icone">${meta.icone}</span>
            <span class="acao__corpo">
              <span class="acao__label">${escapeHtml(meta.label)}${a.detalhe ? `: ${escapeHtml(a.detalhe)}` : ""}</span>
              <span class="acao__quem"><b>${escapeHtml(a.autor)}</b> · ${dataHoraLonga(new Date(a.em).getTime())}</span>
            </span>
          </li>`;
        }).join("")}
      </ol>`
      : `<p style="color:var(--ink-3);font-size:13.5px">Nenhuma ação registrada ainda neste pacote.</p>`}
    </div>`;
}

/**
 * O ticket do cliente é o único sinal que vem de fora do JMS — da própria
 * TikTok Shop. Fica no topo do drawer porque muda a prioridade do pacote
 * inteiro, independente de prazo, motorista ou situação.
 */
function blocoTicket(p, t) {
  const ligado = p.ticketAberto;

  return `
    <div class="ticket ${ligado ? "is-on" : ""}">
      <div class="ticket__row">
        <div>
          <div class="ticket__title">${ligado ? "🔴 Ticket aberto pelo cliente" : "Ticket do cliente"}</div>
          <div class="ticket__hint">${ligado
            ? "Prioridade máxima. Aparece no topo do painel e destacado na cobrança."
            : "Marque quando o cliente abrir reclamação na TikTok Shop."}</div>
        </div>
        <button class="btn ${ligado ? "btn--ghost btn--danger" : "btn--primary"}" id="btnTicket">
          ${ligado ? "Remover" : "Marcar ticket"}
        </button>
      </div>
      ${ligado ? `
      <div class="ticket__ref">
        <input class="input" id="ticketRef" placeholder="Nº do ticket ou protocolo (opcional)"
               value="${escapeHtml(t?.ticket?.ref ?? "")}" />
      </div>` : ""}
    </div>`;
}

/**
 * Só aparece quando a Gestão de Bases foi importada. É o bloco que permite
 * agir: sem endereço e destinatário não dá para tratar cliente ausente.
 */
function secaoCliente(e) {
  if (!e) return "";
  const endereco = enderecoCompleto(e);
  const valor = formatarValor(e.valor);

  return `
    <div class="drawer__section">
      <h3>Destinatário</h3>
      <dl class="kv">
        ${e.destinatario ? `<dt>Cliente</dt><dd>${escapeHtml(e.destinatario)}</dd>` : ""}
        ${endereco ? `<dt>Endereço</dt><dd style="font-weight:500">${escapeHtml(endereco)}</dd>` : ""}
        ${e.rota ? `<dt>Rota</dt><dd>${escapeHtml(e.rota)}</dd>` : ""}
        ${valor ? `<dt>Valor</dt><dd>${escapeHtml(valor)}</dd>` : ""}
        ${e.motivoProblema ? `<dt>Motivo registrado</dt><dd style="font-weight:500">${escapeHtml(e.motivoProblema)}</dd>` : ""}
      </dl>
    </div>`;
}

/**
 * A tratativa é editável em qualquer pacote, não só nos do galpão — uma
 * ocorrência sem desfecho também precisa de dono antes de virar problema.
 */
function secaoTratativa(p, t) {
  const s = situacaoTratativa(t);
  const notas = t?.notas ?? [];

  // Com assinatura do cliente não há tratativa a fazer: o pacote acabou, e
  // mexer no status aqui só criaria a ilusão de que dá para reabrir.
  if (p.entregueEm) {
    return `
      <div class="drawer__section trat" style="${tomVars("ok")}">
        <h3>Tratativa <span class="trat__state">Encerrada</span></h3>
        <p class="hint" style="margin:0">
          ✅ <b>Entregue ao cliente</b>${p.entreguePor ? ` por ${escapeHtml(p.entreguePor)}` : ""}
          em ${dataHoraLonga(p.entregueEm)}. A baixa veio do próprio JMS
          (<code>assinatura de encomenda</code>) e não depende de nada aqui.
        </p>
      </div>`;
  }

  return `
    <div class="drawer__section trat" style="${tomVars(s.tom)}" data-trat="${escapeHtml(p.pkgId)}">
      <h3>Tratativa <span class="trat__state">${escapeHtml(s.label)}</span></h3>

      <div class="trat__status">
        ${[STATUS.ABERTA, STATUS.EM_ANDAMENTO].map((k) => `
          <button class="trat__opt ${t?.status === k || (!t && k === STATUS.ABERTA) ? "is-on" : ""}"
                  style="${tomVars(STATUS_META[k].tom)}" data-status="${k}">
            ${escapeHtml(STATUS_META[k].label)}
          </button>`).join("")}
      </div>

      <div class="trat__finalizar">
        <span class="trat__finalizar-label">Finalizar o pacote como</span>
        <div class="trat__status">
          ${Object.values(DESFECHO).map((d) => {
            const meta = DESFECHO_META[d];
            const ativo = t?.status === STATUS.RESOLVIDA && t?.desfecho === d;
            return `
            <button class="trat__opt ${ativo ? "is-on" : ""}" style="${tomVars(meta.tom)}"
                    data-desfecho="${d}" title="${escapeHtml(meta.hint)}">
              ${meta.icone} ${escapeHtml(meta.label)}
            </button>`;
          }).join("")}
        </div>
      </div>

      <div class="trat__grid">
        <label>Responsável
          <input class="input" id="tratResponsavel" placeholder="Quem vai resolver"
                 value="${escapeHtml(t?.responsavel ?? "")}" />
        </label>
        <label>Prazo
          <input class="input" id="tratPrazo" type="date" value="${escapeHtml(t?.prazo ?? "")}" />
        </label>
      </div>

      ${notas.length ? `
      <ol class="trat__notas">
        ${notas.map((n) => `
          <li>
            <span class="trat__nota-when">${dataHoraLonga(new Date(n.em).getTime())}</span>
            <span class="trat__nota-text">${escapeHtml(n.texto)}</span>
          </li>`).join("")}
      </ol>` : ""}

      <div class="trat__add">
        <input class="input" id="tratNota" placeholder="Registrar tentativa, contato ou decisão…" />
        <button class="btn btn--primary" id="btnAddNota">Registrar</button>
      </div>
    </div>`;
}

function cardDespacho(d) {
  const r = desfecho(d);
  return `
    <div class="dispatch" style="${tomVars(r.tom)}">
      <div class="dispatch__head">
        <span class="dispatch__driver">
          <span class="avatar" style="display:inline-grid;width:22px;height:22px;font-size:10px;vertical-align:-5px;margin-right:6px">${
            d.contaDeTratativa ? "🏠" : escapeHtml(iniciais(d.driver))
          }</span>${escapeHtml(d.driver)}
        </span>
        <span class="dispatch__when">${dataHora(d.startedAt)}</span>
      </div>
      <div class="dispatch__out">${r.texto}</div>
      ${d.contaDeTratativa ? `
      <div class="dispatch__conta">
        Tratativa na base · bipado no JMS como <b>${escapeHtml(d.contaNoJms)}</b>
      </div>` : ""}
    </div>`;
}

function itemTimeline(e) {
  const tom = TOM_DO_FATO[e.fact] ?? "transito";
  const quente = FATO_QUENTE.has(e.fact);

  const nota = e.fact === FACT.OCORRENCIA
    ? [e.problemType, e.problemDesc].filter(Boolean).join(" — ")
    : e.fact === FACT.GALPAO ? e.unshippedType
    : null;

  const onde = [
    e.base,
    e.prevNext ? `↔ ${e.prevNext}` : null,
    e.courier ? `· ${e.courier}` : (e.scanner ? `· bipado por ${e.scanner}` : null),
  ].filter(Boolean).join(" ");

  return `
    <div class="tl ${quente ? "tl--hot" : ""}" style="${tomVars(tom)}">
      <div class="tl__when">${dataHoraLonga(e.ts)}</div>
      <div class="tl__what">${escapeHtml(e.label)}</div>
      ${onde ? `<div class="tl__where">${escapeHtml(onde)}</div>` : ""}
      ${nota ? `<div class="tl__note">${escapeHtml(nota)}</div>` : ""}
    </div>`;
}
