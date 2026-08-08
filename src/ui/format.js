// ---------------------------------------------------------------------------
// ui/format.js — tradução de dados para linguagem de operação.
// Nada de lógica de negócio aqui: só como as coisas aparecem na tela.
// ---------------------------------------------------------------------------

import { SITUACAO, FLAG, FLAG_META, FACT } from "../config.js";

export const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Cada situação tem uma cor com significado fixo em todo o sistema. */
export const TOM = {
  [SITUACAO.ENTREGUE]:                "ok",
  [SITUACAO.RETORNADO_GALPAO]:        "galpao",
  [SITUACAO.COM_MOTORISTA_ESTOURADO]: "atrasado",
  [SITUACAO.OCORRENCIA_EM_ABERTO]:    "ocorrencia",
  [SITUACAO.NA_BASE_NAO_EXPEDIDO]:    "nabase",
  [SITUACAO.COM_MOTORISTA_NO_PRAZO]:  "ok",
  [SITUACAO.EM_TRANSITO]:             "transito",
};

export const tomVars = (tom) =>
  `--tone:var(--${tom});--tone-bg:var(--${tom}-bg);--tone-line:var(--${tom}-line)`;

/** "3h 20min", "2d 4h" — sempre curto o bastante para caber num cartão. */
export function duracao(horas) {
  if (horas == null) return "—";
  if (horas < 1) return `${Math.max(1, Math.round(horas * 60))}min`;
  if (horas < 48) {
    const h = Math.floor(horas);
    const m = Math.round((horas - h) * 60);
    return m ? `${h}h ${m}min` : `${h}h`;
  }
  const d = Math.floor(horas / 24);
  const h = Math.round(horas - d * 24);
  return h ? `${d}d ${h}h` : `${d}d`;
}

export function dataHora(ts) {
  if (ts == null) return "—";
  return new Date(ts).toLocaleString("pt-BR",
    { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function dataHoraLonga(ts) {
  if (ts == null) return "—";
  return new Date(ts).toLocaleString("pt-BR",
    { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Iniciais para o avatar do motorista: "MARIA DA SILVA SOUZA" → "MS". */
export function iniciais(nome) {
  const partes = String(nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "?";
  return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase();
}

/** Primeiro nome em capitalização normal, para as mensagens de cobrança. */
export function primeiroNome(nome) {
  const p = String(nome ?? "").trim().split(/\s+/)[0] ?? "";
  return p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : nome;
}

export const flagLabel = (f) => FLAG_META[f]?.label ?? f;
export const flagHint  = (f) => FLAG_META[f]?.hint ?? "";

/** Flags graves ficam vermelhas; as de atenção, âmbar; as informativas, neutras. */
export function flagClasse(f) {
  if (f === FLAG.REBIPE_SEM_TRATATIVA || f === FLAG.SEM_MOVIMENTO) return "flag";
  if (f === FLAG.TROCA_DE_MOTORISTA || f === FLAG.OCORRENCIA_LENTA) return "flag flag--soft";
  return "flag flag--mute";
}

/** Como cada despacho terminou, em português de operação. */
export function desfecho(d) {
  if (d.aberto) return { texto: `Em aberto há <b>${duracao(d.horasPosse)}</b>`, tom: d.estourado ? "atrasado" : "ok" };
  if (d.anomalia === FLAG.REBIPE_SEM_TRATATIVA)
    return { texto: `Rebipado <b>${duracao(d.horasPosse)}</b> depois, <b>sem tratativa</b>`, tom: "atrasado" };
  if (d.closedBy === FACT.ENTREGA)
    return { texto: `Entregue ao cliente após <b>${duracao(d.horasPosse)}</b>`, tom: "ok" };
  if (d.closedBy === FACT.OCORRENCIA)
    return { texto: `Ocorrência após <b>${duracao(d.horasPosse)}</b>${d.motivo ? ` — ${escapeHtml(d.motivo)}` : ""}`, tom: "ocorrencia" };
  if (d.closedBy === FACT.GALPAO)
    return { texto: `Devolvido ao galpão após <b>${duracao(d.horasPosse)}</b>`, tom: "galpao" };
  return { texto: `Encerrado após <b>${duracao(d.horasPosse)}</b>`, tom: "transito" };
}

/** Fatos que merecem destaque visual na timeline. */
export const FATO_QUENTE = new Set([
  FACT.DESPACHO, FACT.ENTREGA, FACT.OCORRENCIA, FACT.GALPAO, FACT.RECEBIDO_BASE,
]);

export const TOM_DO_FATO = {
  [FACT.ENTREGA]:       "ok",
  [FACT.DESPACHO]:      "ok",
  [FACT.OCORRENCIA]:    "ocorrencia",
  [FACT.GALPAO]:        "galpao",
  [FACT.RECEBIDO_BASE]: "nabase",
};
