// ---------------------------------------------------------------------------
// charge.js — geração das mensagens de cobrança.
//
// A mensagem não pede "atualização" genérica: ela enuncia as três saídas
// legítimas do pacote. É o que transforma a cobrança em instrução — o motorista
// sabe exatamente o que precisa fazer para sair da lista.
// ---------------------------------------------------------------------------

import { FLAG, CORTE_ENTREGA_HOJE } from "./config.js";
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
 * O prazo que a cobrança exige depende da hora em que ela sai.
 *
 * Antes do corte ainda cabe uma rota: o pacote é cobrado para HOJE. Depois do
 * corte, exigir entrega no mesmo dia só produz um "sim" que ninguém cumpre —
 * então a cobrança pede a primeira rota da manhã seguinte.
 *
 * O que NÃO muda com a hora é a exigência da evidência: sem o print da
 * tentativa de contato, a problemática registrada no sistema não sustenta nada
 * quando o cliente reclamar.
 */
export function prazoDaCobranca(agora = new Date(), corte = CORTE_ENTREGA_HOJE) {
  const antesDoCorte = agora.getHours() < corte;

  return {
    antesDoCorte,
    corte,
    linhas: antesDoCorte
      ? [
          `⏰ *Precisam ser entregues HOJE.*`,
          `Se não conseguir entregar, registre a problemática no sistema *com a evidência da tentativa de contato* (print da ligação ou da conversa). Sem a evidência, a problemática não me protege quando o cliente reclamar.`,
        ]
      : [
          `⏰ *Já passou das ${corte}h — preciso destes pacotes entregues AMANHÃ PELA MANHÃ, na primeira rota.*`,
          `Se você tentou hoje e não deu, registre a problemática no sistema ainda hoje *com a evidência da tentativa de contato* (print da ligação ou da conversa).`,
        ],
  };
}

/**
 * Monta a mensagem de WhatsApp para um motorista.
 *
 * @param {Object} m  linha de `byDriver`
 * @returns {string|null}  null quando não há nada a cobrar
 */
export function mensagemCobranca(m, enrichment = {}, agora = new Date()) {
  const abertos = m.abertos;
  if (!abertos.length && !m.rebipes.length) return null;

  const l = [];
  l.push(`${saudacao(agora)}, ${primeiroNome(m.driver)}.`);
  l.push("");

  // Não há mais duas listas. TikTok Shop é entrega no mesmo dia: se o pacote
  // ainda está no circuito, existe um cliente esperando por ele agora — com ou
  // sem chamado aberto na plataforma. Cobrar em dois tons ensinava o motorista
  // a tratar a segunda lista como opcional.
  if (abertos.length) {
    l.push(abertos.length === 1
      ? `Está com você 1 pacote da TikTok Shop com o cliente aguardando:`
      : `Estão com você ${abertos.length} pacotes da TikTok Shop, todos com cliente aguardando:`);
    l.push("");
    for (const d of abertos) l.push(itemPacote(d, enrichment, true));
    l.push("");
    l.push(...prazoDaCobranca(agora).linhas);
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

  l.push(`Só existem três desfechos aceitos para um pacote TikTok:`);
  l.push(`1) entregar;`);
  l.push(`2) registrar a problemática no sistema — com a evidência da tentativa de contato, principalmente em cliente ausente ou endereço incorreto;`);
  l.push(`3) devolver o pacote ao galpão.`);
  l.push("");
  l.push(`Ficar com o pacote sem nenhum desses registros conta como pendência em aberto no seu nome.`);
  l.push("");
  l.push(`Me confirme a situação de cada pedido, por favor.`);

  return l.join("\n");
}

/**
 * Cobrança de fechamento: não pergunta "como está", exige o registro no JMS.
 * É a diferença entre uma conversa que se perde e um dado que fica.
 */
export function mensagemFechamentoMotorista(m, enrichment = {}, pacotes = null, agora = new Date()) {
  const lista = pacotes ?? m.abertos.map((d) => d.pacote);
  if (!lista.length) return null;

  const l = [];
  l.push(`${saudacao(agora)}, ${primeiroNome(m.driver)}.`);
  l.push("");
  l.push(lista.length === 1
    ? `Fechando o dia — ainda consta 1 pacote da TikTok Shop com você:`
    : `Fechando o dia — ainda constam ${lista.length} pacotes da TikTok Shop com você:`);
  l.push("");

  for (const p of lista) {
    const e = enrichment[p.pkgId];
    const quem = e?.destinatario ? ` — ${e.destinatario}` : "";
    const onde = e?.bairro ?? p.destCity;
    // no fechamento tudo que sobrou está no circuito — logo, tudo tem cliente
    // esperando. Não há segunda lista a marcar com bolinha.
    const marca = (p.clienteAguardando ?? p.ticketAberto) ? "🔴" : "•";
    l.push(`${marca} ${p.pkgId}${quem}${onde ? ` (${onde})` : ""}`);
    if (p.horasComMotorista != null) l.push(`   com você há ${duracao(p.horasComMotorista)}`);
  }

  l.push("");
  l.push(...prazoDaCobranca(agora).linhas);
  l.push("");
  l.push(`Preciso que você ATUALIZE NO JMS a situação atual de cada um ainda hoje.`);
  l.push("");
  l.push(`O pacote só sai da minha lista quando estiver registrado como:`);
  l.push(`1) entregue;`);
  l.push(`2) devolvido ao galpão;`);
  l.push(`3) recebido em outra base.`);
  l.push("");
  l.push(`Sem um desses registros o pacote continua no seu nome.`);
  l.push("");
  l.push(`Me confirma quando tiver atualizado, por favor.`);

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
