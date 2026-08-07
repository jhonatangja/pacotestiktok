// ---------------------------------------------------------------------------
// atividades.js — o registro de quem fez o quê, e quando.
//
// É o diário de bordo humano do pacote, separado da timeline do JMS (que é
// máquina bipando). Aqui fica o que a EQUIPE fez: cobrou, marcou ticket,
// assumiu a tratativa, finalizou.
//
// Append-only de propósito: uma ação registrada nunca é editada nem apagada.
// Se fosse mutável, não serviria para prestar contas.
// ---------------------------------------------------------------------------

export const ACAO = {
  COBRANCA:        "COBRANCA",
  TICKET_ABERTO:   "TICKET_ABERTO",
  TICKET_REMOVIDO: "TICKET_REMOVIDO",
  RESPONSAVEL:     "RESPONSAVEL",
  PRAZO:           "PRAZO",
  STATUS:          "STATUS",
  NOTA:            "NOTA",
  FINALIZADO:      "FINALIZADO",
  REABERTO:        "REABERTO",
};

export const ACAO_META = {
  [ACAO.COBRANCA]:        { label: "Cobrou o motorista", icone: "📲", tom: "ok" },
  [ACAO.TICKET_ABERTO]:   { label: "Marcou ticket do cliente", icone: "🔴", tom: "atrasado" },
  [ACAO.TICKET_REMOVIDO]: { label: "Removeu o ticket", icone: "⚪", tom: "transito" },
  [ACAO.RESPONSAVEL]:     { label: "Definiu responsável", icone: "🙋", tom: "nabase" },
  [ACAO.PRAZO]:           { label: "Definiu prazo", icone: "📅", tom: "nabase" },
  [ACAO.STATUS]:          { label: "Mudou o status", icone: "🔄", tom: "galpao" },
  [ACAO.NOTA]:            { label: "Registrou", icone: "📝", tom: "transito" },
  [ACAO.FINALIZADO]:      { label: "Finalizou", icone: "✅", tom: "ok" },
  [ACAO.REABERTO]:        { label: "Reabriu o caso", icone: "↩️", tom: "galpao" },
};

/** Identidade do operador logado — preenchida no boot (ver app.js). */
let autorAtual = "local";
export function definirAutor(nome) { autorAtual = String(nome || "local"); }
export function autor() { return autorAtual; }

export function novaAtividade(pkgId, tipo, detalhe = "") {
  const em = new Date().toISOString();
  return {
    // a chave inclui o autor e o instante: dois operadores agindo no mesmo
    // segundo geram registros distintos em vez de sobrescrever um ao outro
    id: `${pkgId}|${em}|${tipo}|${autorAtual}`,
    pkgId, tipo, detalhe: String(detalhe ?? ""), autor: autorAtual, em,
  };
}

/** Atividades de um pacote, da mais recente para a mais antiga. */
export function doPacote(atividades, pkgId) {
  return atividades
    .filter((a) => a.pkgId === pkgId)
    .sort((a, b) => new Date(b.em) - new Date(a.em));
}

export function ultimaDoPacote(atividades, pkgId) {
  return doPacote(atividades, pkgId)[0] ?? null;
}

const inicioDoDia = (ref = new Date()) =>
  new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()).getTime();

/** Foi cobrado hoje? É o que evita cobrar duas vezes no mesmo dia. */
export function cobradoHoje(atividades, pkgId, agora = new Date()) {
  const corte = inicioDoDia(agora);
  return doPacote(atividades, pkgId).some(
    (a) => a.tipo === ACAO.COBRANCA && new Date(a.em).getTime() >= corte
  );
}

export function ultimaCobranca(atividades, pkgId) {
  return doPacote(atividades, pkgId).find((a) => a.tipo === ACAO.COBRANCA) ?? null;
}

/** Quantas ações cada operador registrou — para o resumo do fechamento. */
export function porAutor(atividades, desde = null) {
  const corte = desde ? new Date(desde).getTime() : 0;
  const conta = {};
  for (const a of atividades) {
    if (new Date(a.em).getTime() < corte) continue;
    conta[a.autor] = (conta[a.autor] ?? 0) + 1;
  }
  return conta;
}
