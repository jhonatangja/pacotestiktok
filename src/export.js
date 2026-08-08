// ---------------------------------------------------------------------------
// export.js — o que o sistema devolve para o mundo.
//
// Duas saídas, ambas fecham um ciclo manual:
//  · a lista de códigos ainda em aberto, para colar de volta no JMS amanhã
//    (o export do JMS é por lista de códigos — sem isso o operador teria que
//    montar essa lista à mão todo dia);
//  · o relatório do dia em CSV, para prestação de contas.
// ---------------------------------------------------------------------------

import { SITUACAO, SITUACAO_META, FLAG_META } from "./config.js";
import { situacaoTratativa, STATUS } from "./tratativa.js";

/**
 * Códigos que ainda merecem consulta no próximo export do JMS.
 *
 * Fica de fora tudo que já está encerrado — e quem decide isso é o motor, não
 * a tratativa: um pacote com assinatura do cliente ou recebido em outra base
 * está resolvido sem que ninguém tenha marcado nada à mão.
 */
export function codigosParaReconsultar(packages, tratativas = {}) {
  return packages
    .filter((p) => !p.resolvido && tratativas[p.pkgId]?.status !== STATUS.RESOLVIDA)
    .sort((a, b) => b.prioridade - a.prioridade)
    .map((p) => p.pkgId);
}

const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV com ponto e vírgula e BOM — abre direto no Excel em português. */
export function relatorioCsv(packages, tratativas = {}, enrichment = {}) {
  const colunas = [
    "Pedido", "Base responsável", "Situação", "Ação necessária", "Motorista atual", "Horas com motorista",
    "Despachos", "Rebipes sem tratativa", "Entrou no circuito", "Horas para resolver",
    "Horas na base", "Horas até expedir da base",
    "Horas sem movimento", "Dias desde a coleta", "Cidade", "Destinatário", "Endereço", "Valor",
    "Tratativa", "Responsável", "Prazo", "Último registro", "Alertas",
  ];

  const linhas = packages.map((p) => {
    const t = tratativas[p.pkgId];
    const e = enrichment[p.pkgId] ?? {};
    const rebipes = p.despachos.filter((d) => d.anomalia).length;
    const ultimaNota = t?.notas?.length ? t.notas[t.notas.length - 1].texto : "";

    return [
      p.pkgId,
      p.baseResponsavel ?? "",
      SITUACAO_META[p.situacao]?.label ?? p.situacao,
      SITUACAO_META[p.situacao]?.acao ?? "",
      p.motoristaAtual ?? "",
      p.horasComMotorista ?? "",
      p.totalDespachos,
      rebipes,
      p.recebidoNaBaseEm ? new Date(p.recebidoNaBaseEm).toLocaleString("pt-BR") : "",
      p.horasParaResolver ?? "",
      p.horasNaBase ?? "",
      p.horasAteExpedir ?? "",
      p.horasSemMovimento,
      p.diasDesdeColeta ?? "",
      p.destCity ?? "",
      e.destinatario ?? "",
      [e.endereco, e.bairro].filter(Boolean).join(", "),
      e.valor ?? "",
      t ? situacaoTratativa(t).label : "",
      t?.responsavel ?? "",
      t?.prazo ?? "",
      ultimaNota,
      p.flags.map((f) => FLAG_META[f]?.label ?? f).join(" | "),
    ].map(csvCell).join(";");
  });

  return "﻿" + [colunas.join(";"), ...linhas].join("\r\n");
}

export function baixar(nome, conteudo, tipo = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function nomeDoArquivo(prefixo, ext) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${prefixo}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${ext}`;
}

/** Contagem por situação, para o cabeçalho da tela de exportação. */
export function resumoDoDia(packages) {
  const por = {};
  for (const p of packages) {
    const k = SITUACAO_META[p.situacao]?.label ?? p.situacao;
    por[k] = (por[k] ?? 0) + 1;
  }
  return por;
}

export { SITUACAO };
