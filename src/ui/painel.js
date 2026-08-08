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

import { SITUACAO, SITUACAO_META, FLAG, BASES_OPERACAO, apelidoDaBase } from "../config.js";
import { escapeHtml, TOM, tomVars, duracao } from "./format.js";
import { cardPacote, cardAguardando, listaVazia } from "./cards.js";

// Situações que exigem alguém fazer alguma coisa hoje.
// Só o que já saiu do controle da base fica de fora (trânsito nacional).
const EXIGE_ACAO = [
  SITUACAO.RETORNADO_GALPAO,
  SITUACAO.COM_MOTORISTA_ESTOURADO,
  SITUACAO.EM_TRATATIVA_BASE,
  SITUACAO.OCORRENCIA_EM_ABERTO,
  SITUACAO.NA_BASE_NAO_EXPEDIDO,
  SITUACAO.COM_MOTORISTA_NO_PRAZO,
];

const DICA = {
  "Tratar no galpão":  "Voltou fisicamente para a base. Precisa de dono e prazo.",
  "Cobrar motorista":  "TikTok é entrega no mesmo dia — todo pacote com motorista é pendência viva.",
  "Tratar na base":    "Bipado para uma conta de tratativa. Está aqui dentro — não há motorista a cobrar.",
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

/** Só os pacotes sob responsabilidade da base escolhida. "" = todas. */
export const daBase = (packages, base) =>
  !base ? packages : packages.filter((p) => p.baseResponsavel === base);

export function renderPainel(el, todos, aguardando = [], base = "") {
  if (el.filtroBases) el.filtroBases.innerHTML = "";

  if (!todos.length && !aguardando.length) {
    el.stats.innerHTML = "";
    el.grupos.innerHTML = listaVazia("Nenhum pacote importado ainda. Comece pela aba Importar.", "📄");
    return;
  }

  const abertos = emAberto(todos);
  if (!abertos.length && !aguardando.length) {
    el.stats.innerHTML = "";
    el.grupos.innerHTML = listaVazia(
      `Tudo resolvido — os ${todos.length} pacotes estão na aba Resolvidos.`, "✅");
    return;
  }

  if (el.filtroBases) el.filtroBases.innerHTML = renderFiltroBases(abertos, base);

  // O que não é da base escolhida sai da tela inteira — inclusive dos números,
  // senão o indicador diria uma coisa e a lista mostraria outra.
  const packages = daBase(abertos, base);
  el.stats.innerHTML = renderStats(packages, base ? [] : aguardando);
  el.grupos.innerHTML = renderGrupos(packages, base ? [] : aguardando);
}

/**
 * A operação tem mais de uma base em Rio Verde, e misturá-las esconde de quem é
 * a pendência. A barra só aparece quando há de fato mais de uma com pacote —
 * numa base só ela seria um controle que não controla nada.
 */
function renderFiltroBases(packages, atual) {
  const conta = (b) => packages.filter((p) => p.baseResponsavel === b).length;
  const comPacote = BASES_OPERACAO.filter((b) => conta(b) > 0);
  if (comPacote.length < 2) return "";

  const botao = (valor, rotulo, n) => `
    <button class="basebtn ${atual === valor ? "is-on" : ""}" data-base="${escapeHtml(valor)}">
      ${escapeHtml(rotulo)} <span class="basebtn__n">${n}</span>
    </button>`;

  return `
    <span class="basebar__label">Responsabilidade</span>
    ${botao("", "Todas", packages.length)}
    ${comPacote.map((b) => botao(b, apelidoDaBase(b), conta(b))).join("")}
    ${packages.some((p) => !p.baseResponsavel)
      ? `<span class="hint">${packages.filter((p) => !p.baseResponsavel).length} ainda sem recebimento em base nenhuma</span>`
      : ""}`;
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

  // Cada pendência aparece UMA vez, no grupo da ação que ela exige.
  //
  // O ticket do cliente já teve um grupo próprio no topo, e isso atrapalhava
  // mais do que ajudava: ele arrancava pacotes de "Tratar no galpão" e de
  // "Cobrar motorista" e os juntava numa lista só, misturando quem está na base
  // com quem está na rua — duas ações completamente diferentes. Agora o ticket
  // é destaque DENTRO do grupo (🔴, primeiro da lista), não um grupo à parte.
  const porAcao = new Map();
  for (const situacao of EXIGE_ACAO) {
    const meta = SITUACAO_META[situacao];
    const doGrupo = packages.filter((p) => p.situacao === situacao);
    if (!doGrupo.length) continue;

    if (!porAcao.has(meta.acao)) porAcao.set(meta.acao, { peso: 0, tom: TOM[situacao], pacotes: [] });
    const g = porAcao.get(meta.acao);
    g.pacotes.push(...doGrupo);
    // o grupo herda o peso e a cor da situação mais grave que contém
    if (meta.peso > g.peso) { g.peso = meta.peso; g.tom = TOM[situacao]; }
  }

  const ordenados = [...porAcao.entries()].sort((a, b) => b[1].peso - a[1].peso);
  for (const [acao, g] of ordenados) {
    const comReclamacao = g.pacotes.filter((p) => p.ticketAberto).length;
    grupos.push(secao({
      titulo: acao,
      dica: DICA[acao] ?? "",
      tom: g.tom,
      extra: comReclamacao
        ? `🔴 ${comReclamacao} com reclamação do cliente`
        : "",
      // dentro do grupo, quem tem reclamação aberta vem primeiro
      pacotes: g.pacotes.sort((a, b) =>
        (b.ticketAberto === true) - (a.ticketAberto === true) || b.prioridade - a.prioridade),
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

function secao({ titulo, dica, tom, pacotes, extra = "" }) {
  return `
    <section class="group" style="${tomVars(tom)}">
      <div class="group__head">
        <h3>${escapeHtml(titulo)}</h3>
        <span class="group__badge">${pacotes.length}</span>
        ${extra ? `<span class="group__extra">${escapeHtml(extra)}</span>` : ""}
        <span class="group__hint">${escapeHtml(dica)}</span>
      </div>
      <div class="cards">${pacotes.map(cardPacote).join("")}</div>
    </section>`;
}
