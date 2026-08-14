// ---------------------------------------------------------------------------
// acao.js — o que fazer com ESTE pacote, agora.
//
// O painel sempre agrupou por ação, mas o grupo diz a categoria, não a tarefa:
// "Cobrar motorista" não informa se é para exigir entrega, ligar para o cliente
// ou mandar devolver — e essas três são coisas diferentes com desfechos
// diferentes. Quem abre o sistema às 7h precisa ler o cartão e agir, sem
// reconstruir a regra de cabeça.
//
// Aqui a situação, a causa da ocorrência e o prazo do destino viram UMA frase
// imperativa, com o dono ao lado. É a única função que traduz estado em tarefa,
// então mudar a regra da operação é mudar este arquivo, não seis telas.
// ---------------------------------------------------------------------------

import {
  SITUACAO, CAUSA, CAUSA_META, assistenteDaBase, EMBARCADOR_META,
} from "./config.js";

/**
 * @returns {{ titulo, detalhe, dono, tom, urgente }}
 *   titulo  — o verbo. O que a pessoa faz.
 *   detalhe — por que, e com que prazo.
 *   dono    — quem executa: assistente da base, ou "—" quando é do motorista.
 */
export function proximaAcao(p) {
  const assistente = assistenteDaBase(p.baseResponsavel);
  const meta = p.causa ? CAUSA_META[p.causa] : null;

  if (p.resolvido) {
    return { titulo: "Nada a fazer", detalhe: "Caso encerrado.", dono: null, tom: "ok", urgente: false };
  }

  // A causa da ocorrência manda em qualquer situação de posse: endereço errado
  // não se resolve indo de novo, e fora da área não se resolve tentando.
  if (p.causa === CAUSA.ENDERECO) {
    return {
      titulo: "Ligar para o cliente",
      detalhe: `${p.motivoAtual ?? meta.label}. Confirmar o endereço e, sem contato, mandar devolver hoje.`,
      dono: assistente, tom: "ocorrencia", urgente: true,
    };
  }
  if (p.causa === CAUSA.AUSENCIA) {
    return {
      titulo: "Combinar horário com o cliente",
      detalhe: "Sem horário combinado, o pacote volta para o galpão hoje.",
      dono: assistente, tom: "ocorrencia", urgente: true,
    };
  }
  if (p.causa === CAUSA.FORA_DA_AREA) {
    return {
      titulo: "Mandar devolver ao galpão",
      detalhe: `${p.motivoAtual ?? "Fora da área"} — não é cidade nossa. Devolver hoje para voltar à malha.`,
      dono: assistente, tom: "galpao", urgente: true,
    };
  }

  switch (p.situacao) {
    case SITUACAO.RETORNADO_GALPAO:
      return {
        titulo: "Dar dono e prazo no galpão",
        detalhe: "Voltou fisicamente para a base. Sem responsável, ninguém toca nele.",
        dono: assistente, tom: "galpao", urgente: true,
      };

    case SITUACAO.EM_TRATATIVA_BASE:
      return {
        titulo: "Resolver na base",
        detalhe: "Está bipado numa conta de tratativa — não saiu para a rua.",
        dono: p.motoristaAtual ?? assistente, tom: "nabase", urgente: true,
      };

    case SITUACAO.COM_MOTORISTA_ESTOURADO:
    case SITUACAO.COM_MOTORISTA_NO_PRAZO:
      return {
        titulo: "Cobrar o motorista",
        detalhe: EMBARCADOR_META[p.embarcador]?.mesmoDia
          ? "Entrega no mesmo dia — entregar, registrar a problemática com evidência, ou devolver."
          : "Entregar, registrar a problemática com evidência, ou devolver ao galpão.",
        dono: p.motoristaAtual, tom: p.situacao === SITUACAO.COM_MOTORISTA_ESTOURADO ? "atrasado" : "ok",
        urgente: p.situacao === SITUACAO.COM_MOTORISTA_ESTOURADO,
      };

    case SITUACAO.OCORRENCIA_EM_ABERTO:
      return {
        titulo: "Definir o destino",
        detalhe: "A problemática foi registrada e parou aí. Nova tentativa ou devolução?",
        dono: assistente, tom: "ocorrencia", urgente: true,
      };

    case SITUACAO.NA_BASE_NAO_EXPEDIDO:
      return {
        titulo: "Colocar na rota",
        detalhe: p.atrasadoNaExpedicao
          ? `Parado há ${Math.round(p.horasAteExpedir)}h — o prazo daqui é ${p.slaExpedicaoHoras}h.`
          : `Dentro do prazo de ${p.slaExpedicaoHoras}h para este destino.`,
        dono: assistente, tom: "nabase", urgente: !!p.atrasadoNaExpedicao,
      };

    case SITUACAO.EM_TRANSITO:
      return {
        titulo: "Só acompanhar",
        detalhe: "Ainda não chegou na base. Nada a fazer aqui.",
        dono: null, tom: "transito", urgente: false,
      };

    default:
      return {
        titulo: "Verificar",
        detalhe: "Situação sem regra definida — vale olhar o histórico.",
        dono: assistente, tom: "transito", urgente: false,
      };
  }
}

/** Só o que exige alguém fazer alguma coisa hoje. */
export const exigeAcao = (p) => !p.resolvido && proximaAcao(p).urgente;

/**
 * As ações agrupadas por quem executa — a lista que o assistente abre de manhã
 * para saber o que é dele.
 */
export function porDono(packages) {
  const mapa = new Map();
  for (const p of packages) {
    if (p.resolvido) continue;
    const a = proximaAcao(p);
    if (!a.urgente) continue;
    const dono = a.dono ?? "Sem dono definido";
    if (!mapa.has(dono)) mapa.set(dono, []);
    mapa.get(dono).push({ pacote: p, acao: a });
  }
  return [...mapa.entries()]
    .map(([dono, itens]) => ({ dono, itens }))
    .sort((a, b) => b.itens.length - a.itens.length || a.dono.localeCompare(b.dono));
}
