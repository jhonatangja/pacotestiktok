// ---------------------------------------------------------------------------
// aguardando.js — pacotes lançados à mão, antes de existir bipe.
//
// A reclamação do cliente quase sempre chega ANTES do JMS: o ticket é aberto na
// plataforma horas antes de o pacote aparecer em qualquer export. Sem um lugar
// para lançá-lo, esse pacote só existe na cabeça de quem atendeu o cliente.
//
// Um lançamento desses não inventa histórico — é só um código com ticket aberto
// esperando a próxima importação para virar pacote de verdade. Por isso ele
// nunca entra no motor de domínio: lá só entra o que foi bipado. O que sustenta
// o registro aqui é a tratativa, que a importação nunca sobrescreve.
// ---------------------------------------------------------------------------

import { STATUS } from "./tratativa.js";

const H = 3600000;

/**
 * Códigos com tratativa aberta que ainda não apareceram em importação nenhuma.
 *
 * Ordena do mais antigo para o mais novo: quem espera há mais tempo é quem
 * corre risco de ter sido esquecido — e, se já passaram várias importações sem
 * o código aparecer, provavelmente ele foi digitado errado.
 */
export function aguardandoImportacao(tratativas = {}, packages = [], agora = Date.now()) {
  const bipados = new Set(packages.map((p) => p.pkgId));

  return Object.values(tratativas)
    .filter((t) => t?.pkgId && !bipados.has(t.pkgId) && t.status !== STATUS.RESOLVIDA)
    .map((t) => {
      const em = t.criadaEm ? new Date(t.criadaEm).getTime() : null;
      return {
        pkgId: t.pkgId,
        ticketAberto: !!t.ticket?.aberto,
        ticketRef: t.ticket?.ref || null,
        criadaEm: em,
        horasEsperando: em == null ? null : Math.round(((agora - em) / H) * 10) / 10,
      };
    })
    .sort((a, b) => (a.criadaEm ?? 0) - (b.criadaEm ?? 0) || a.pkgId.localeCompare(b.pkgId));
}

/** Os códigos, na ordem da lista — para colar na consulta do JMS. */
export const codigosAguardando = (aguardando) => aguardando.map((a) => a.pkgId);
