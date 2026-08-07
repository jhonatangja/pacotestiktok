// ---------------------------------------------------------------------------
// enrich.js — cruzamento com a planilha "Gestão de Bases".
//
// O relatório de escaneamento conta o que ACONTECEU, mas não diz para quem nem
// onde: não tem destinatário, endereço, bairro, valor nem rota. Sem isso o
// operador não consegue tratar "cliente ausente" nem "endereço incorreto", que
// são a maioria das ocorrências.
//
// As duas planilhas cruzam por `Número de pedido JMS`. Este import é opcional:
// o sistema funciona sem ele, só com menos contexto na hora de tratar.
// ---------------------------------------------------------------------------

import { normalize, normalizeCode, valOrNull, cleanProblemText } from "./ingest.js";

// Mapeamento estável do export "Exportar carta de porte de entrega*.xlsx".
// Atenção aos dois rótulos enganosos do JMS:
//  · "Tempo de entrega" é o horário de CARREGAMENTO, não o da entrega;
//  · "Complemento" carrega o ENDEREÇO, não um complemento no sentido estrito.
export const COLUNAS_BASE = [
  { key: "pkgId",       header: "Número de pedido JMS",             required: true,
    keywords: ["numero de pedido jms", "pedido", "codigo"] },
  { key: "destinatario", header: "Destinatário",                    keywords: ["destinatario", "cliente", "recebedor"] },
  { key: "endereco",     header: "Complemento",                     keywords: ["complemento", "endereco", "referencia"] },
  { key: "bairro",       header: "Distrito destinatário",           keywords: ["distrito destinatario", "bairro"] },
  { key: "cidade",       header: "Cidade Destino",                  keywords: ["cidade destino", "cidade"] },
  { key: "cep",          header: "CEP destino",                     keywords: ["cep destino", "cep"] },
  { key: "valor",        header: "Valor Mercadoria",                keywords: ["valor mercadoria", "valor"] },
  { key: "rota",         header: "3 Segmentos",                     keywords: ["3 segmentos", "rota", "segmento"] },
  { key: "motorista",    header: "Responsável pela entrega",        keywords: ["responsavel pela entrega", "motorista", "entregador"] },
  { key: "statusEntrega", header: "Marca de assinatura",            keywords: ["marca de assinatura", "status entrega", "status"] },
  { key: "entregueEm",   header: "Horário da entrega",              keywords: ["horario da entrega", "hora entrega"] },
  { key: "motivoProblema", header: "Motivos dos pacotes problemáticos", keywords: ["motivos dos pacotes problematicos", "motivo problema"] },
  { key: "origemPedido", header: "Origem do Pedido",                keywords: ["origem do pedido", "marketplace"] },
];

function resolver(headers) {
  const norm = headers.map(normalize);
  const index = {};
  let faltaChave = true;

  for (const col of COLUNAS_BASE) {
    let at = norm.indexOf(normalize(col.header));
    if (at === -1) {
      for (const kw of col.keywords ?? []) {
        at = norm.indexOf(normalize(kw));
        if (at !== -1) break;
      }
    }
    if (at === -1) continue;
    index[col.key] = at;
    if (col.key === "pkgId") faltaChave = false;
  }
  return { index, faltaChave };
}

/**
 * Constrói os registros de enriquecimento a partir das linhas da Gestão de Bases.
 * @returns {{itens, faltaChave, ignoradas}}
 */
export function buildEnrichment(rows, headers) {
  const { index, faltaChave } = resolver(headers);
  if (faltaChave) return { itens: [], faltaChave: true, ignoradas: rows.length };

  const porPacote = new Map();
  let ignoradas = 0;

  for (const row of rows) {
    const pkgId = normalizeCode(valOrNull(row[index.pkgId]));
    if (!pkgId) { ignoradas++; continue; }

    const item = { pkgId };
    for (const [key, at] of Object.entries(index)) {
      if (key === "pkgId") continue;
      let v = valOrNull(row[at]);
      if (!v) continue;
      // esta planilha também traz o motivo em português e chinês colados
      if (key === "motivoProblema") v = cleanProblemText(v);
      item[key] = v;
    }
    // a última linha do mesmo pedido é a mais recente — vence
    porPacote.set(pkgId, { ...(porPacote.get(pkgId) ?? {}), ...item });
  }

  return { itens: [...porPacote.values()], faltaChave: false, ignoradas };
}

/** "R$ 129,90" a partir do que o JMS entregar (número ou string com vírgula). */
export function formatarValor(raw) {
  if (raw == null || raw === "") return null;
  let s = String(raw).trim().replace(/[Rr]\$\s?/, "").replace(/\s/g, "");
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? null : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Endereço em uma linha, do jeito que se lê para sair entregando. */
export function enderecoCompleto(e) {
  if (!e) return null;
  return [e.endereco, e.bairro, e.cidade, e.cep].filter(Boolean).join(" · ") || null;
}
