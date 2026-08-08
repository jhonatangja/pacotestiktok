// ---------------------------------------------------------------------------
// ui/painel.js — o Painel de Ação.
//
// Não é uma lista de pacotes: é uma lista de PENDÊNCIAS, agrupadas pela ação
// que cada uma exige e ordenadas por criticidade. Quem abre o sistema de manhã
// precisa saber o que fazer, não navegar atrás da informação.
//
// O agrupamento é pela AÇÃO, não pela situação: "com motorista atrasado" e
// "com motorista no prazo" pedem a mesma coisa — cobrar — e por isso aparecem
// juntos. O prazo muda a cor do cartão, não o que precisa ser feito.
// ---------------------------------------------------------------------------

import { SITUACAO, SITUACAO_META, FLAG } from "../config.js";
import { escapeHtml, TOM, tomVars, duracao } from "./format.js";
import { cardPacote, cardAguardando, listaVazia } from "./cards.js";

// Situações que exigem alguém fazer alguma coisa hoje.
// Só o que já saiu do controle da base fica de fora (trânsito nacional).
const EXIGE_ACAO = [
  SITUACAO.RETORNADO_GALPAO,
  SITUACAO.COM_MOTORISTA_ESTOURADO,
  SITUACAO.OCORRENCIA_EM_ABERTO,
  SITUACAO.NA_BASE_NAO_EXPEDIDO,
  SITUACAO.COM_MOTORISTA_NO_PRAZO,
];

const DICA = {
  "Tratar no galpão":  "Voltou fisicamente para a base. Precisa de dono e prazo.",
  "Cobrar motorista":  "TikTok é entrega no mesmo dia — todo pacote com motorista é pendência viva.",
  "Definir destino":   "Registrou a problemática e parou aí. Onde o pacote está?",
  "Expedir da base":   "Recebido e não despachado. O gargalo é interno, não do motorista.",
};

/** Caso encerrado pelo operador sai da tela de pendências — vai para "Resolvidos". */
export const emAberto = (packages) => packages.filter((p) => !p.resolvido);

export function pendencias(packages) {
  return emAberto(packages).filter((p) => EXIGE_ACAO.includes(p.situacao));
}

export function comTicket(packages) {
  return emAberto(packages).filter((p) => p.ticketAberto);
}

export function renderPainel(el, todos, aguardando = []) {
  if (!todos.length && !aguardando.length) {
    el.stats.innerHTML = "";
    el.grupos.innerHTML = listaVazia("Nenhum pacote importado ainda. Comece pela aba Importar.", "📄");
    return;
  }

  const packages = emAberto(todos);
  if (!packages.length && !aguardando.length) {
    el.stats.innerHTML = "";
    el.grupos.innerHTML = listaVazia(
      `Tudo resolvido — os ${todos.length} pacotes estão na aba Resolvidos.`, "✅");
    return;
  }

  el.stats.innerHTML = renderStats(packages, aguardando);
  el.grupos.innerHTML = renderGrupos(packages, aguardando);
}

// ---------------------------------------------------------------------------

function renderStats(packages, aguardando) {
  const conta = (s) => packages.filter((p) => p.situacao === s).length;
  const comFlag = (f) => packages.filter((p) => p.flags.includes(f)).length;

  // O ticket lançado à mão conta aqui mesmo sem bipe: para o cliente que
  // reclamou, o pacote existe — o JMS é que ainda não sabe.
  const ticketsAguardando = aguardando.filter((a) => a.ticketAberto).length;

  const cards = [
    { valor: comTicket(packages).length + ticketsAguardando, label: "ticket do cliente", tom: "atrasado" },
    ...(aguardando.length
      ? [{ valor: aguardando.length, label: "aguardando importação", tom: "transito" }]
      : []),
    { valor: pendencias(packages).length, label: "exigem ação hoje", tom: "galpao" },
    { valor: conta(SITUACAO.COM_MOTORISTA_ESTOURADO) + conta(SITUACAO.COM_MOTORISTA_NO_PRAZO),
      label: "com motorista", tom: "ok" },
    { valor: conta(SITUACAO.RETORNADO_GALPAO), label: "no galpão", tom: "galpao" },
    { valor: comFlag(FLAG.REBIPE_SEM_TRATATIVA), label: "rebipe sem tratativa", tom: "ocorrencia" },
    // "aguardando expedição" e não "parados na base": a flag PARADO_NA_BASE é
    // histórica (já aconteceu) e esta estatística é da situação atual.
    { valor: conta(SITUACAO.NA_BASE_NAO_EXPEDIDO), label: "aguardando expedição", tom: "nabase" },
  ];

  return cards.map((c) => `
    <div class="stat" style="--accent:var(--${c.tom})">
      <span class="stat__value" style="color:var(--${c.tom})">${c.valor}</span>
      <span class="stat__label">${escapeHtml(c.label)}</span>
    </div>`).join("");
}

function renderGrupos(packages, aguardando = []) {
  const grupos = [];
  const jaListados = new Set();

  // 1. Ticket do cliente vem antes de tudo: a reclamação já está aberta na
  //    plataforma, então o prazo interno deixou de importar.
  const tickets = comTicket(packages);
  if (tickets.length) {
    tickets.forEach((p) => jaListados.add(p.pkgId));
    grupos.push(secao({
      titulo: "Prioridade máxima — ticket do cliente",
      dica: "O cliente abriu reclamação na TikTok Shop. Resolver antes de qualquer outra coisa.",
      tom: "atrasado",
      pacotes: tickets,
    }));
  }

  // 2. Demais pendências, agrupadas pela ação necessária.
  const porAcao = new Map();
  for (const situacao of EXIGE_ACAO) {
    const meta = SITUACAO_META[situacao];
    const doGrupo = packages.filter((p) => p.situacao === situacao && !jaListados.has(p.pkgId));
    if (!doGrupo.length) continue;

    if (!porAcao.has(meta.acao)) porAcao.set(meta.acao, { peso: 0, tom: TOM[situacao], pacotes: [] });
    const g = porAcao.get(meta.acao);
    g.pacotes.push(...doGrupo);
    // o grupo herda o peso e a cor da situação mais grave que contém
    if (meta.peso > g.peso) { g.peso = meta.peso; g.tom = TOM[situacao]; }
  }

  const ordenados = [...porAcao.entries()].sort((a, b) => b[1].peso - a[1].peso);
  for (const [acao, g] of ordenados) {
    grupos.push(secao({
      titulo: acao,
      dica: DICA[acao] ?? "",
      tom: g.tom,
      pacotes: g.pacotes.sort((a, b) => b.prioridade - a.prioridade),
    }));
  }

  if (!grupos.length && !aguardando.length) {
    grupos.push(listaVazia("Nenhuma pendência aberta. A operação está limpa.", "✅"));
  }

  // 3. Lançados à mão: existem para nós, ainda não para o JMS. Ficam abaixo das
  //    pendências reais de propósito — não há o que fazer com eles hoje além de
  //    puxá-los na próxima consulta, e um cartão sem dado nenhum não pode
  //    empurrar para baixo um pacote que está com motorista há 30 horas.
  if (aguardando.length) {
    const maisVelho = aguardando[0]?.horasEsperando;
    grupos.push(`
      <section class="group" style="${tomVars("transito")}">
        <div class="group__head">
          <h3>Aguardando importação</h3>
          <span class="group__badge">${aguardando.length}</span>
          <span class="group__hint">Lançados à mão, sem bipe no JMS${
            maisVelho ? ` · o mais antigo há ${duracao(maisVelho)}` : ""
          }. Entram sozinhos na próxima planilha importada.</span>
        </div>
        <div class="cards">${aguardando.map(cardAguardando).join("")}</div>
      </section>`);
  }

  // O que ainda não chegou na base não vira cartão — vira uma linha de contexto.
  const transito = packages.filter((p) => p.situacao === SITUACAO.EM_TRANSITO);
  if (transito.length) {
    const maisVelho = transito.reduce((max, p) => Math.max(max, p.horasSemMovimento ?? 0), 0);
    grupos.push(`
      <section class="group" style="${tomVars("transito")}">
        <div class="group__head">
          <h3>Ainda em trânsito</h3>
          <span class="group__badge">${transito.length}</span>
          <span class="group__hint">Fora da sua base${maisVelho ? ` · o mais parado há ${duracao(maisVelho)}` : ""}</span>
        </div>
      </section>`);
  }

  return grupos.join("");
}

function secao({ titulo, dica, tom, pacotes }) {
  return `
    <section class="group" style="${tomVars(tom)}">
      <div class="group__head">
        <h3>${escapeHtml(titulo)}</h3>
        <span class="group__badge">${pacotes.length}</span>
        <span class="group__hint">${escapeHtml(dica)}</span>
      </div>
      <div class="cards">${pacotes.map(cardPacote).join("")}</div>
    </section>`;
}
