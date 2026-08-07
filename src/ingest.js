// ---------------------------------------------------------------------------
// ingest.js — do arquivo bruto do JMS até a lista de eventos limpa.
//
// Responsabilidades: resolver colunas, normalizar texto, traduzir tipos de
// bipagem para fatos, deduplicar e mesclar de forma idempotente.
// Não conhece IndexedDB nem interface. `parseWorkbook` é o único ponto que
// depende do SheetJS (global XLSX) — o resto é puro e testável em Node.
// ---------------------------------------------------------------------------

import {
  COLUMNS, SCAN_TYPES, FACT, STAGE, FACT_GROUP, FACT_WEIGHT, FACT_ORDER, DEDUPE,
} from "./config.js";

// ---------------------------------------------------------------------------
// TEXTO
// ---------------------------------------------------------------------------

/** minúsculo, sem acento, sem pontuação — usado para casar cabeçalhos e tipos. */
export function normalize(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCode(s) {
  return String(s ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * O JMS grava o motivo em português e chinês, colado e com pontos no lugar dos
 * espaços: "Ausência.do.destinatário客户不在" → "Ausência do destinatário".
 */
export function cleanProblemText(s) {
  return String(s ?? "")
    .replace(/[⺀-鿿豈-﫿︰-﹏＀-￯]/g, "")
    .replace(/[.。]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Remove o prefixo de filial do nome do motorista
 * ("F RVD - NOME DO MOTORISTA" → "NOME DO MOTORISTA").
 * Mesma regra do projeto COBRANÇA; se o resultado ficar vazio, devolve o original.
 */
export function stripDriverPrefix(raw, prefix) {
  const original = String(raw ?? "").trim();
  const dash = (v) => String(v ?? "").replace(/[–—]/g, "-");
  let s = original;
  const p = dash(prefix).trim();
  if (p && dash(s).toUpperCase().startsWith(p.toUpperCase())) s = s.slice(p.length);
  s = s.replace(/^[\s\-–—:]+/, "").trim();
  return s || original;
}

export function valOrNull(v) {
  const s = String(v ?? "").trim();
  return s === "" || s.toLowerCase() === "nan" ? null : s;
}

// ---------------------------------------------------------------------------
// DATAS
// ---------------------------------------------------------------------------

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

/**
 * Aceita Date (SheetJS com cellDates), "YYYY-MM-DD HH:mm:ss", "DD/MM/YYYY HH:mm"
 * e o serial numérico do Excel. Devolve Date ou null — nunca Invalid Date.
 */
export function parseTimestamp(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v) ? null : v;

  if (typeof v === "number" && isFinite(v)) {
    return new Date(EXCEL_EPOCH_MS + Math.round(v * 86400000));
  }

  const s = String(v).trim();
  if (!s) return null;

  // formato nativo do JMS: 2026-08-06 18:01:49
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));

  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);

  // formato brasileiro, caso o JMS mude a localização do export
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return new Date(year, +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  }

  const fallback = new Date(s);
  return isNaN(fallback) ? null : fallback;
}

// ---------------------------------------------------------------------------
// COLUNAS
// ---------------------------------------------------------------------------

/**
 * Casa os cabeçalhos reais com o dicionário: primeiro pelo nome exato do JMS,
 * depois por keyword. Devolve {index: {campo: coluna}, missing: [campos obrigatórios]}.
 */
export function resolveColumns(headers) {
  const norm = headers.map(normalize);
  const index = {};
  const missing = [];

  for (const col of COLUMNS) {
    let at = norm.indexOf(normalize(col.header));
    if (at === -1) {
      for (const kw of col.keywords) {
        const n = normalize(kw);
        at = norm.findIndex((h) => h === n);
        if (at !== -1) break;
      }
    }
    if (at === -1) {
      for (const kw of col.keywords) {
        const n = normalize(kw);
        at = norm.findIndex((h) => h && (h.includes(n) || n.includes(h)));
        if (at !== -1) break;
      }
    }
    if (at === -1) {
      if (col.required) missing.push(col);
      continue;
    }
    index[col.key] = at;
  }
  return { index, missing };
}

// ---------------------------------------------------------------------------
// EVENTOS
// ---------------------------------------------------------------------------

/**
 * Identidade estável do evento. Repetir a importação do mesmo arquivo (ou de
 * arquivos com sobreposição) nunca duplica linha — a chave é o próprio conteúdo.
 */
export function eventId(e) {
  return [e.pkgId, e.tsISO, e.rawType, e.base ?? "", e.scanner ?? ""].join("|");
}

const isoLocal = (d) => {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T` +
         `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

/**
 * Converte as linhas cruas em eventos tipados.
 * Puro: não toca em XLSX nem em armazenamento.
 *
 * @returns {{events, unknownTypes, skipped, missing}}
 */
export function buildEvents(rows, headers, opts = {}) {
  const { index, missing } = resolveColumns(headers);
  if (missing.length) {
    return { events: [], unknownTypes: [], skipped: rows.length, missing };
  }

  const sourceFile = opts.sourceFile ?? null;
  const importedAt = opts.importedAt ?? new Date().toISOString();
  const get = (row, key) => (index[key] === undefined ? null : valOrNull(row[index[key]]));

  const events = [];
  const unknown = new Map();
  let skipped = 0;

  for (const row of rows) {
    const pkgId = normalizeCode(get(row, "pkgId"));
    const ts = parseTimestamp(index.ts === undefined ? null : row[index.ts]);
    const rawType = get(row, "rawType");

    // sem pacote, sem data ou sem tipo, a linha não é um evento — descarta e conta.
    if (!pkgId || !ts || !rawType) { skipped++; continue; }

    const known = SCAN_TYPES[normalize(rawType)];
    if (!known) unknown.set(rawType, (unknown.get(rawType) ?? 0) + 1);

    const e = {
      pkgId,
      ts: ts.getTime(),
      tsISO: isoLocal(ts),
      rawType,
      fact: known ? known.fact : FACT.OUTRO,
      stage: known ? known.stage : STAGE.OUTRO,
      label: known ? known.label : rawType,
      base: get(row, "base"),
      prevNext: get(row, "prevNext"),
      scanner: get(row, "scanner"),
      courier: get(row, "courier"),
      lote: get(row, "lote"),
      viagem: get(row, "viagem"),
      problemType: cleanProblemText(get(row, "problemType")) || null,
      problemDesc: get(row, "problemDesc"),
      unshippedType: get(row, "unshippedType"),
      destCity: get(row, "destCity"),
      destState: get(row, "destState"),
      destBase: get(row, "destBase"),
      originBase: get(row, "originBase"),
      orderSource: get(row, "orderSource"),
      weight: get(row, "weight"),
      destZip: get(row, "destZip"),
      uploadedAt: get(row, "uploadedAt"),
      sourceFile,
      importedAt,
    };
    e.id = eventId(e);
    events.push(e);
  }

  const unknownTypes = [...unknown.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  return { events, unknownTypes, skipped, missing: [] };
}

/** Ordena por timestamp; empate no mesmo segundo resolve pela ordem lógica do fato. */
export function sortEvents(events) {
  const rank = (f) => {
    const i = FACT_ORDER.indexOf(f);
    return i === -1 ? FACT_ORDER.length : i;
  };
  return [...events].sort(
    (a, b) => a.ts - b.ts || rank(a.fact) - rank(b.fact) || a.id.localeCompare(b.id)
  );
}

/**
 * Colapsa o ruído de bipagem em três passadas:
 *
 *  1. identidade — a mesma linha importada de novo;
 *  2. grupo no mesmo instante — `Chegadas ao centro` + `Digitalização de descarga`
 *     (e o par expedição/carregamento) são o mesmo fato físico gravado duas vezes;
 *  3. janela de tempo — equipamento e humano bipando com segundos de diferença,
 *     e o clique duplo do conferente. Despacho usa janela maior e chaveia pelo
 *     motorista, porque trocar de motorista no mesmo minuto É um evento novo.
 *
 * Na amostra real isso leva 214 linhas a ~90 eventos.
 */
export function dedupeEvents(events) {
  const byId = new Map();
  for (const e of events) if (!byId.has(e.id)) byId.set(e.id, e);

  const ordered = sortEvents([...byId.values()]);
  const kept = [];
  const lastByKey = new Map();

  for (const e of ordered) {
    const group = FACT_GROUP[e.fact] ?? e.fact;
    const key = e.fact === FACT.DESPACHO
      ? `${e.pkgId}|DESPACHO|${normalize(e.courier) || normalize(e.base)}`
      : `${e.pkgId}|${group}|${normalize(e.base)}`;
    const janela = e.fact === FACT.DESPACHO ? DEDUPE.despachoMs : DEDUPE.genericoMs;

    const prev = lastByKey.get(key);
    if (prev && e.ts - prev.event.ts <= janela) {
      // dentro da janela: mantém o fato mais informativo, mas guarda o descartado
      const keptEv = kept[prev.at];
      const wNew = FACT_WEIGHT[e.fact] ?? 0;
      const wOld = FACT_WEIGHT[keptEv.fact] ?? 0;
      if (wNew > wOld) {
        kept[prev.at] = { ...e, ts: keptEv.ts, tsISO: keptEv.tsISO, mergedFrom: [...(keptEv.mergedFrom ?? []), keptEv.id] };
      } else {
        keptEv.mergedFrom = [...(keptEv.mergedFrom ?? []), e.id];
      }
      lastByKey.set(key, { event: prev.event, at: prev.at });
      continue;
    }

    kept.push({ ...e });
    lastByKey.set(key, { event: e, at: kept.length - 1 });
  }

  return kept;
}

/**
 * Mescla eventos novos sobre os já armazenados. Idempotente por construção:
 * a chave é o conteúdo do evento, então reimportar não duplica nem apaga nada.
 */
export function mergeEvents(existing, incoming) {
  const map = new Map(existing.map((e) => [e.id, e]));
  let added = 0;
  for (const e of incoming) {
    if (map.has(e.id)) continue;
    map.set(e.id, e);
    added++;
  }
  return { events: sortEvents([...map.values()]), added, total: map.size };
}

// ---------------------------------------------------------------------------
// ARQUIVO (browser — depende do SheetJS global)
// ---------------------------------------------------------------------------

/** Lê um File/Blob e devolve {headers, rows}. Só funciona no navegador. */
export function parseWorkbook(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo."));
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(new Uint8Array(evt.target.result), { type: "array", cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
        if (!grid.length) return reject(new Error("A planilha está vazia."));
        const headers = grid[0].map((h) => String(h ?? "").trim());
        const rows = grid.slice(1).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
        resolve({ headers, rows });
      } catch (err) {
        reject(new Error("Não foi possível interpretar o arquivo: " + err.message));
      }
    };
    reader.readAsArrayBuffer(file);
  });
}
