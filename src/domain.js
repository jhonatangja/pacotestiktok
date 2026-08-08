// ---------------------------------------------------------------------------
// domain.js — o motor. Transforma eventos em pendências acionáveis.
//
// Conceito central: a unidade de cobrança NÃO é o pacote, é o DESPACHO.
// Cada `bipe de saída para entrega` abre um despacho sob a responsabilidade de
// um motorista. Ele só pode fechar de três formas legítimas — ocorrência,
// entrega ou retorno ao galpão. Se o que fecha um despacho é um NOVO despacho,
// o pacote circulou sem ninguém prestar contas: é o rebipe sem tratativa, a
// dívida que o JMS não mostra.
// ---------------------------------------------------------------------------

import {
  FACT, FECHAMENTOS, SLA_PADRAO, PREFIXO_MOTORISTA_PADRAO, BASE_OPERACAO,
  SITUACAO, SITUACAO_META, FLAG, FLAG_META, CLIENTE_AGUARDANDO_SEMPRE,
  responsavelDaConta,
} from "./config.js";
import { sortEvents, stripDriverPrefix } from "./ingest.js";
import { STATUS, DESFECHO } from "./tratativa.js";

const H = 3600000;
const horas = (ms) => (ms == null ? null : ms / H);
const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

/**
 * @param {Array} events  eventos já deduplicados
 * @param {Object} opts   { now, sla, prefixoMotorista, tratativas }
 * @returns {{packages, byDriver, resumo, now}}
 */
export function buildPackages(events, opts = {}) {
  const now = opts.now instanceof Date ? opts.now.getTime() : (opts.now ?? Date.now());
  const sla = { ...SLA_PADRAO, ...(opts.sla ?? {}) };
  const prefixo = opts.prefixoMotorista ?? PREFIXO_MOTORISTA_PADRAO;
  // as tratativas entram aqui porque o ticket do cliente é regra de prioridade,
  // não decoração de tela: ele reordena a fila inteira
  const tratativas = opts.tratativas ?? {};

  const porPacote = new Map();
  for (const e of events) {
    if (!porPacote.has(e.pkgId)) porPacote.set(e.pkgId, []);
    porPacote.get(e.pkgId).push(e);
  }

  const packages = [];
  for (const [pkgId, brutos] of porPacote) {
    packages.push(montarPacote(pkgId, sortEvents(brutos),
      { now, sla, prefixo, tratativa: tratativas[pkgId] }));
  }

  // O ticket do cliente é um NÍVEL, não um peso somado: por maior que seja o
  // peso, um pacote velho o suficiente acabaria passando na frente de quem já
  // tem reclamação aberta na plataforma. Ordena em dois degraus.
  packages.sort((a, b) =>
    (a.resolvido === true) - (b.resolvido === true) ||
    (b.ticketAberto === true) - (a.ticketAberto === true) ||
    b.prioridade - a.prioridade ||
    a.pkgId.localeCompare(b.pkgId));

  return {
    packages,
    byDriver: agruparPorMotorista(packages, now),
    resumo: resumir(packages),
    now,
  };
}

// ---------------------------------------------------------------------------

function montarPacote(pkgId, timeline, { now, sla, prefixo, tratativa }) {
  const ultimo = timeline[timeline.length - 1];
  const primeiro = timeline[0];

  const coletadoEm = timeline.find((e) => e.fact === FACT.COLETA)?.ts ?? null;

  // Recebimentos formais em base de última milha. O primeiro que bate com a
  // nossa base marca o início da responsabilidade; um recebimento em base
  // DIFERENTE significa que outra unidade assumiu o pacote — ele saiu daqui.
  const recebimentos = timeline.filter((e) => e.fact === FACT.RECEBIDO_BASE);
  const daNossaBase = (b) => !b || !BASE_OPERACAO ||
    b.trim().toUpperCase() === BASE_OPERACAO.trim().toUpperCase();

  const recebidoNaBaseEm = (recebimentos.find((e) => daNossaBase(e.base)) ?? recebimentos[0])?.ts ?? null;
  const emOutraBase = recebimentos.find(
    (e) => !daNossaBase(e.base) && (recebidoNaBaseEm == null || e.ts >= recebidoNaBaseEm)
  ) ?? null;

  // `assinatura de encomenda`: o cliente assinou. É a evidência mais forte que
  // existe no JMS e encerra o pacote sem depender de decisão de ninguém aqui.
  const entrega = timeline.find((e) => e.fact === FACT.ENTREGA) ?? null;

  // --- passada única: abre e fecha despachos na ordem em que os fatos ocorrem
  const despachos = [];
  let aberto = null;

  for (const e of timeline) {
    if (e.fact === FACT.DESPACHO) {
      if (aberto) {
        // fechado por um novo despacho — ninguém prestou contas no meio
        aberto.closedAt = e.ts;
        aberto.closedBy = null;
        aberto.anomalia = FLAG.REBIPE_SEM_TRATATIVA;
      }
      // Conta de tratativa: o pacote ficou na base e quem responde é o
      // assistente, não o nome que o JMS gravou. A tradução acontece aqui, na
      // origem, para que TUDO a jusante — cartão, cobrança, cadastro — já veja
      // a pessoa certa sem precisar saber que a conta existe.
      const doJms = stripDriverPrefix(e.courier ?? e.scanner ?? "", prefixo);
      const assistente = responsavelDaConta(doJms);

      aberto = {
        pkgId,
        driverRaw: e.courier ?? e.scanner ?? null,
        driver: assistente ?? (doJms || "(sem motorista)"),
        contaDeTratativa: !!assistente,
        contaNoJms: assistente ? doJms : null,
        startedAt: e.ts,
        closedAt: null,
        closedBy: null,
        anomalia: null,
        despachadoPor: e.scanner ?? null,
      };
      despachos.push(aberto);
      continue;
    }

    // Ocorrências e retornos anteriores ao primeiro despacho existem (são da
    // origem, não da última milha) e não fecham despacho nenhum.
    if (aberto && FECHAMENTOS.includes(e.fact)) {
      aberto.closedAt = e.ts;
      aberto.closedBy = e.fact;
      aberto.motivo = e.problemType ?? e.unshippedType ?? null;
      aberto.motivoDesc = e.problemDesc ?? null;
      aberto = null;
    }
  }

  for (const d of despachos) {
    d.aberto = d.closedAt == null;
    d.horasPosse = round1(horas((d.closedAt ?? now) - d.startedAt));
    d.estourado = d.aberto && d.horasPosse > sla.posseMotoristaHoras;
  }

  const despachoAberto = despachos.find((d) => d.aberto) ?? null;

  // --- situação (excludente, na ordem de urgência)
  let situacao;
  // Entregue vem antes de tudo: o cliente assinou, acabou a discussão.
  if (entrega) situacao = SITUACAO.ENTREGUE;
  // Outra base recebeu: o pacote saiu do circuito daqui e nada mais é cobrável.
  else if (emOutraBase) situacao = SITUACAO.RECEBIDO_OUTRA_BASE;
  else if (ultimo.fact === FACT.GALPAO) situacao = SITUACAO.RETORNADO_GALPAO;
  else if (despachoAberto) situacao = despachoAberto.contaDeTratativa
    ? SITUACAO.EM_TRATATIVA_BASE
    : despachoAberto.estourado
    ? SITUACAO.COM_MOTORISTA_ESTOURADO
    : SITUACAO.COM_MOTORISTA_NO_PRAZO;
  else if (ultimo.fact === FACT.OCORRENCIA) situacao = SITUACAO.OCORRENCIA_EM_ABERTO;
  else if (recebidoNaBaseEm != null) situacao = SITUACAO.NA_BASE_NAO_EXPEDIDO;
  else situacao = SITUACAO.EM_TRANSITO;

  // --- tempos
  const primeiroDespachoAposBase = recebidoNaBaseEm == null ? null
    : despachos.find((d) => d.startedAt >= recebidoNaBaseEm) ?? null;
  const horasAteExpedir = recebidoNaBaseEm == null ? null
    : round1(horas((primeiroDespachoAposBase?.startedAt ?? now) - recebidoNaBaseEm));

  const horasSemMovimento = round1(horas(now - ultimo.ts));
  const diasDesdeColeta = coletadoEm == null ? null
    : round1(horas(now - coletadoEm) / 24);

  // O relógio que a base responde: começa no `bipe de recebimento`. O tempo de
  // trânsito nacional que veio antes não é responsabilidade daqui.
  const horasNaBase = recebidoNaBaseEm == null ? null
    : round1(horas(now - recebidoNaBaseEm));

  // --- resolvido: o operador declarou o caso encerrado
  //
  // A resolução vale enquanto o pacote não se mexer de novo. Se chegar um bipe
  // posterior, o caso reabre sozinho — dar baixa e o pacote voltar a circular
  // é justamente como uma tratativa some do radar.
  const resolvidaEm = tratativa?.status === STATUS.RESOLVIDA
    ? (tratativa.atualizadaEm ? new Date(tratativa.atualizadaEm).getTime() : Infinity)
    : null;
  // Um bipe posterior reabre o caso — exceto a entrega. Assinatura que chega
  // depois da baixa manual é confirmação do desfecho, não movimento novo.
  const movimentoAposResolver = resolvidaEm != null && ultimo.ts > resolvidaEm && !entrega;
  const finalizadoPeloOperador = resolvidaEm != null && !movimentoAposResolver;

  // Dois desfechos encerram o pacote sozinhos, por evidência do próprio JMS:
  // a assinatura do cliente e o recebimento em outra base. Nenhuma decisão
  // humana muda isso — e a assinatura ganha de qualquer marcação manual, porque
  // é o fato mais forte que o sistema conhece.
  const resolvido = !!entrega || finalizadoPeloOperador || !!emOutraBase;
  const desfecho = entrega ? DESFECHO.ENTREGUE
    : emOutraBase ? "outra_base"
    : (finalizadoPeloOperador ? (tratativa?.desfecho ?? null) : null);

  // --- flags (acumuláveis)
  const flags = [];

  // Duas coisas diferentes que a cobrança precisa distinguir:
  //
  //  · `ticketAberto` — alguém marcou à mão que o cliente abriu chamado na
  //    plataforma. É o que sobe o pacote para o topo do painel e ganha chip.
  //  · `clienteAguardando` — o pacote está no circuito. Como TikTok é entrega
  //    no mesmo dia, isso já significa cliente esperando, e a cobrança trata
  //    TODOS assim. Não vira flag nem peso: uma marca que todo mundo tem não
  //    ordena nada, só polui o cartão.
  const ticketAberto = !!tratativa?.ticket?.aberto && !resolvido;
  const clienteAguardando = CLIENTE_AGUARDANDO_SEMPRE
    && !resolvido && situacao !== SITUACAO.EM_TRANSITO;
  if (ticketAberto) flags.push(FLAG.TICKET_CLIENTE);
  if (movimentoAposResolver) flags.push(FLAG.MOVIMENTO_APOS_RESOLVIDA);

  const rebipes = despachos.filter((d) => d.anomalia === FLAG.REBIPE_SEM_TRATATIVA);
  if (rebipes.length) flags.push(FLAG.REBIPE_SEM_TRATATIVA);

  // Já são os nomes traduzidos: o assistente no lugar da conta de tratativa.
  const motoristas = [...new Set(despachos.map((d) => d.driver))];
  if (motoristas.length > 1) flags.push(FLAG.TROCA_DE_MOTORISTA);

  const ocorrenciasDeUltimaMilha = despachos.filter((d) => d.closedBy === FACT.OCORRENCIA);
  if (ocorrenciasDeUltimaMilha.some((d) => d.horasPosse > sla.registroOcorrenciaHoras)) {
    flags.push(FLAG.OCORRENCIA_LENTA);
  }
  if (ocorrenciasDeUltimaMilha.length >= 2) flags.push(FLAG.REINCIDENTE);

  if (horasAteExpedir != null && horasAteExpedir > sla.expedicaoDaBaseHoras) {
    flags.push(FLAG.PARADO_NA_BASE);
  }
  if (horasSemMovimento > sla.semMovimentoHoras) flags.push(FLAG.SEM_MOVIMENTO);

  // --- criticidade: situação + flags + envelhecimento
  // O envelhecimento conta a partir do recebimento na base, não da coleta:
  // um pacote que demorou 4 dias no trânsito nacional e chegou hoje não é
  // mais urgente que outro que está há 3 dias parado aqui.
  const diasDeResponsabilidade = horasNaBase != null
    ? horasNaBase / 24
    : (diasDesdeColeta ?? 0);

  const prioridade =
    (SITUACAO_META[situacao]?.peso ?? 0) +
    flags.reduce((s, f) => s + (FLAG_META[f]?.peso ?? 0), 0) +
    Math.min(60, Math.floor(horasSemMovimento / 12) * 5) +
    Math.min(40, Math.floor(diasDeResponsabilidade) * 4);

  const ctx = timeline.find((e) => e.destCity) ?? {};

  return {
    pkgId,
    situacao,
    situacaoLabel: SITUACAO_META[situacao]?.label ?? situacao,
    acao: SITUACAO_META[situacao]?.acao ?? "Verificar",
    flags,
    prioridade,

    ticketAberto,
    clienteAguardando,
    ticketRef: tratativa?.ticket?.ref || null,
    resolvido,
    desfecho,
    resolvidaEm: entrega ? entrega.ts
      : emOutraBase ? emOutraBase.ts
      : (resolvido ? resolvidaEm : null),
    responsavelResolucao: finalizadoPeloOperador ? (tratativa?.responsavel || null) : null,
    outraBase: emOutraBase ? emOutraBase.base : null,
    entregueEm: entrega?.ts ?? null,
    entreguePor: entrega ? stripDriverPrefix(entrega.courier ?? entrega.scanner ?? "", prefixo) || null : null,

    // Quem responde pelo pacote agora — o motorista de rua ou, numa conta de
    // tratativa, o assistente da base. A responsabilidade é dele do mesmo jeito.
    motoristaAtual: despachoAberto?.driver ?? null,
    naBase: !!despachoAberto?.contaDeTratativa,
    horasComMotorista: despachoAberto?.horasPosse ?? null,
    despachos,
    totalDespachos: despachos.length,
    motoristasEnvolvidos: motoristas,

    coletadoEm,
    recebidoNaBaseEm,
    horasNaBase,
    horasAteExpedir,
    horasSemMovimento,
    diasDesdeColeta,
    primeiroEventoEm: primeiro.ts,
    ultimoEventoEm: ultimo.ts,
    ultimoEvento: ultimo.label,
    ultimoFato: ultimo.fact,

    destCity: ctx.destCity ?? null,
    destState: ctx.destState ?? null,
    destBase: ctx.destBase ?? null,
    originBase: ctx.originBase ?? null,
    orderSource: ctx.orderSource ?? null,
    destZip: ctx.destZip ?? null,

    timeline,
  };
}

// ---------------------------------------------------------------------------

/**
 * Agrupa a dívida por motorista. Um pacote com dois despachos de motoristas
 * diferentes aparece na conta dos dois — cada um responde pelo seu período.
 */
export function agruparPorMotorista(packages, now) {
  const mapa = new Map();
  const slot = (nome) => {
    if (!mapa.has(nome)) {
      mapa.set(nome, {
        driver: nome, abertos: [], rebipes: [], ocorrenciasLentas: [], tickets: [],
        pacotes: new Set(), horasMaisAntiga: 0,
      });
    }
    return mapa.get(nome);
  };

  for (const p of packages) {
    // caso encerrado pelo operador não gera cobrança
    if (p.resolvido) continue;
    for (const d of p.despachos) {
      const s = slot(d.driver);
      s.pacotes.add(p.pkgId);
      if (d.aberto) {
        s.abertos.push({ ...d, pacote: p });
        s.horasMaisAntiga = Math.max(s.horasMaisAntiga, d.horasPosse ?? 0);
        if (p.ticketAberto) s.tickets.push({ ...d, pacote: p });
      }
      if (d.anomalia === FLAG.REBIPE_SEM_TRATATIVA) s.rebipes.push({ ...d, pacote: p });
      if (d.closedBy === FACT.OCORRENCIA && d.horasPosse > SLA_PADRAO.registroOcorrenciaHoras) {
        s.ocorrenciasLentas.push({ ...d, pacote: p });
      }
    }
  }

  return [...mapa.values()]
    .map((s) => ({
      ...s,
      pacotes: [...s.pacotes],
      totalAbertos: s.abertos.length,
      totalRebipes: s.rebipes.length,
      totalTickets: s.tickets.length,
      // ordena a fila de cobrança pelo que dói: ticket do cliente na frente de
      // tudo, depois rebipe, e só então tempo de posse
      score: s.tickets.length * 100 + s.abertos.length * 10 + s.rebipes.length * 25 +
             s.ocorrenciasLentas.length * 15 + Math.floor(s.horasMaisAntiga / 12) * 5,
    }))
    .sort((a, b) => b.score - a.score || a.driver.localeCompare(b.driver));
}

function resumir(packages) {
  const porSituacao = {};
  const porFlag = {};
  for (const p of packages) {
    porSituacao[p.situacao] = (porSituacao[p.situacao] ?? 0) + 1;
    for (const f of p.flags) porFlag[f] = (porFlag[f] ?? 0) + 1;
  }
  return {
    totalPacotes: packages.length,
    totalDespachos: packages.reduce((s, p) => s + p.totalDespachos, 0),
    despachosAbertos: packages.reduce((s, p) => s + p.despachos.filter((d) => d.aberto).length, 0),
    porSituacao,
    porFlag,
  };
}

/**
 * Pacotes ainda em aberto — a lista de códigos para reconsultar no JMS amanhã.
 * Fecha o loop de ingestão: o export é por lista de códigos, então o sistema
 * precisa devolver quais códigos ainda merecem consulta.
 */
export function codigosEmAberto(packages) {
  return packages
    .filter((p) => !p.resolvido)
    .filter((p) => p.situacao !== SITUACAO.EM_TRANSITO || p.flags.includes(FLAG.SEM_MOVIMENTO))
    .map((p) => p.pkgId);
}
