// ---------------------------------------------------------------------------
// charge.js — geração das mensagens de cobrança.
//
// A mensagem não pede "atualização" genérica: ela enuncia as três saídas
// legítimas do pacote. É o que transforma a cobrança em instrução — o motorista
// sabe exatamente o que precisa fazer para sair da lista.
// ---------------------------------------------------------------------------

import { FLAG } from "./config.js";
import { duracao, primeiroNome } from "./ui/format.js";

/**
 * Uma linha por pacote. Com a Gestão de Bases importada ela já sai identificando
 * cliente e endereço — sem isso o motorista precisa perguntar de qual pacote se
 * trata, e a cobrança vira uma conversa de ida e volta.
 */
function itemPacote(d, enrichment, destacado) {
  const p = d.pacote;
  const e = enrichment[p.pkgId];
  const marca = destacado ? "🔴" : "•";

  const cabeca = [
    `${marca} ${p.pkgId}`,
    e?.destinatario ? ` — ${e.destinatario}` : "",
  ].join("");

  const endereco = [e?.endereco, e?.bairro].filter(Boolean).join(", ") || e?.cidade || p.destCity;
  const tempo = `com você há ${duracao(d.horasPosse)}${d.estourado ? " (fora do prazo)" : ""}`;
  const ticket = destacado && p.ticketRef ? ` · ticket ${p.ticketRef}` : "";

  return endereco
    ? `${cabeca}\n   ${endereco}\n   ${tempo}${ticket}`
    : `${cabeca} · ${tempo}${ticket}`;
}

export function saudacao(agora = new Date()) {
  const h = agora.getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

/**
 * Monta a mensagem de WhatsApp para um motorista.
 *
 * @param {Object} m  linha de `byDriver`
 * @returns {string|null}  null quando não há nada a cobrar
 */
export function mensagemCobranca(m, enrichment = {}) {
  const abertos = m.abertos;
  if (!abertos.length && !m.rebipes.length) return null;

  const l = [];
  l.push(`${saudacao()}, ${primeiroNome(m.driver)}.`);
  l.push("");

  // Os pacotes com reclamação aberta na TikTok Shop vêm primeiro e separados:
  // o cliente já está cobrando a plataforma, então esses não esperam prazo.
  const comTicket = abertos.filter((d) => d.pacote.ticketAberto);
  const semTicket = abertos.filter((d) => !d.pacote.ticketAberto);

  if (comTicket.length) {
    l.push(comTicket.length === 1
      ? `🔴 PRIORIDADE MÁXIMA — o cliente abriu reclamação na TikTok Shop deste pedido:`
      : `🔴 PRIORIDADE MÁXIMA — o cliente abriu reclamação na TikTok Shop destes ${comTicket.length} pedidos:`);
    l.push("");
    for (const d of comTicket) l.push(itemPacote(d, enrichment, true));
    l.push("");
    l.push(comTicket.length === 1
      ? `Preciso deste pacote resolvido antes dos demais. Me dê um retorno assim que possível.`
      : `Preciso destes pacotes resolvidos antes dos demais. Me dê um retorno assim que possível.`);
    l.push("");
  }

  if (semTicket.length) {
    l.push(semTicket.length === 1
      ? `Está com você mais 1 pacote da TikTok Shop ainda sem baixa:`
      : `Estão com você mais ${semTicket.length} pacotes da TikTok Shop ainda sem baixa:`);
    l.push("");
    for (const d of semTicket) l.push(itemPacote(d, enrichment, false));
    l.push("");
  }

  // O rebipe é a cobrança mais importante: o pacote saiu de novo sem que
  // nenhum desfecho tivesse sido registrado no ciclo anterior.
  if (m.rebipes.length) {
    l.push(m.rebipes.length === 1
      ? `Um pacote saiu de novo para entrega sem que você tivesse registrado nada no ciclo anterior:`
      : `${m.rebipes.length} pacotes saíram de novo para entrega sem nenhum registro no ciclo anterior:`);
    for (const d of m.rebipes) {
      l.push(`• ${d.pacote.pkgId} · ficou ${duracao(d.horasPosse)} com você sem baixa`);
    }
    l.push("");
  }

  l.push(`Todo pacote TikTok precisa ser resolvido no mesmo dia, e só existem três desfechos aceitos:`);
  l.push(`1) entregar;`);
  l.push(`2) registrar a problemática no sistema — com print da tentativa de contato, principalmente em cliente ausente ou endereço incorreto;`);
  l.push(`3) devolver o pacote ao galpão.`);
  l.push("");
  l.push(`Ficar com o pacote sem nenhum desses registros conta como pendência em aberto no seu nome.`);
  l.push("");
  l.push(`Me confirme a situação de cada pedido e a previsão de resolução, por favor.`);

  return l.join("\n");
}

/** Resumo curto do que pesa contra o motorista — usado nos cartões da lista. */
export function resumoMotorista(m) {
  const partes = [];
  if (m.totalTickets) partes.push(`${m.totalTickets} com ticket`);
  if (m.totalAbertos) partes.push(`${m.totalAbertos} em aberto`);
  if (m.totalRebipes) partes.push(`${m.totalRebipes} rebipe${m.totalRebipes > 1 ? "s" : ""}`);
  if (m.ocorrenciasLentas.length) partes.push(`${m.ocorrenciasLentas.length} ocorrência${m.ocorrenciasLentas.length > 1 ? "s" : ""} tardia${m.ocorrenciasLentas.length > 1 ? "s" : ""}`);
  return partes.join(" · ") || "sem pendências";
}

/** Quantos pacotes deste motorista já estouraram o prazo de posse. */
export function atrasados(m) {
  return m.abertos.filter((d) => d.estourado).length;
}

export const temFlag = (p, f) => p.flags.includes(f);
export const FLAGS = FLAG;
