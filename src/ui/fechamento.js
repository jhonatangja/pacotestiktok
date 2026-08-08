// ---------------------------------------------------------------------------
// ui/fechamento.js — o fechamento do dia.
//
// Uma varredura de tudo que ainda está no circuito, para cobrar de todo mundo
// a atualização da situação no JMS antes de encerrar o expediente. O pacote só
// sai daqui quando for finalizado — entregue, devolvido, ou recebido em outra
// base (esse último o próprio JMS avisa).
//
// A tela responde uma pergunta: "posso ir embora?" — e a resposta é não
// enquanto houver pacote sem cobrança hoje.
// ---------------------------------------------------------------------------

import { SITUACAO } from "../config.js";
import { cobradoHoje, ultimaCobranca } from "../atividades.js";
import { telefoneValido } from "../contatos.js";
import { escapeHtml, tomVars, duracao, dataHora, iniciais } from "./format.js";
import { listaVazia } from "./cards.js";

/** Tudo que ainda não saiu do circuito — o universo do fechamento. */
export function noCircuito(packages) {
  return packages.filter((p) => !p.resolvido && p.situacao !== SITUACAO.EM_TRANSITO);
}

export function renderFechamento(el, packages, byDriver, contatos, atividades) {
  const circuito = noCircuito(packages);

  if (!circuito.length) {
    el.innerHTML = listaVazia(
      "Nenhum pacote no circuito. Tudo finalizado — pode encerrar o dia.", "🌙");
    return;
  }

  const pendentes = circuito.filter((p) => !cobradoHoje(atividades, p.pkgId));
  const cobrados = circuito.length - pendentes.length;

  // com motorista: cobrança vai pelo WhatsApp de cada um
  const comMotorista = agruparPorMotorista(circuito, byDriver, contatos, atividades);
  // sem motorista: estão na base/galpão, a cobrança é interna
  const naBase = circuito.filter((p) => !p.motoristaAtual);

  el.innerHTML = `
    <div class="page-head">
      <h2>Fechamento do dia</h2>
      <p>Todo pacote listado aqui ainda está no circuito e precisa ter a situação
         atualizada no JMS até ser finalizado — entregue, devolvido, ou recebido
         em outra base.</p>
    </div>

    <div class="stats" style="margin-bottom:22px">
      <div class="stat" style="--accent:var(--navy)">
        <span class="stat__value">${circuito.length}</span>
        <span class="stat__label">no circuito</span>
      </div>
      <div class="stat" style="--accent:var(--atrasado)">
        <span class="stat__value" style="color:var(--atrasado)">${pendentes.length}</span>
        <span class="stat__label">sem cobrança hoje</span>
      </div>
      <div class="stat" style="--accent:var(--ok)">
        <span class="stat__value" style="color:var(--ok)">${cobrados}</span>
        <span class="stat__label">já cobrados hoje</span>
      </div>
      <div class="stat" style="--accent:var(--galpao)">
        <span class="stat__value" style="color:var(--galpao)">${comMotorista.length}</span>
        <span class="stat__label">motoristas a cobrar</span>
      </div>
    </div>

    <div class="fech-acoes">
      <button class="btn btn--primary" id="btnCopiarCircuito">
        Copiar os ${circuito.length} códigos do circuito
      </button>
      <span class="hint">Um por linha, pronto para colar na consulta do JMS.</span>
    </div>

    ${pendentes.length === 0 ? `
      <div class="card card--ok" style="margin-bottom:20px">
        <strong>Todos os ${circuito.length} pacotes do circuito já foram cobrados hoje.</strong>
        Falta só a resposta de cada um para finalizar no sistema.
      </div>` : ""}

    <section class="group" style="${tomVars("atrasado")}">
      <div class="group__head">
        <h3>Cobrar atualização no JMS</h3>
        <span class="group__badge">${comMotorista.length}</span>
        <span class="group__hint">Um clique por motorista — a mensagem já vai pronta.</span>
      </div>
      <div class="fechamento-lista">
        ${comMotorista.length
          ? comMotorista.map((m) => linhaMotorista(m)).join("")
          : `<p class="hint">Nenhum pacote com motorista agora.</p>`}
      </div>
    </section>

    ${naBase.length ? `
    <section class="group" style="${tomVars("nabase")};margin-top:26px">
      <div class="group__head">
        <h3>Na base, sem motorista</h3>
        <span class="group__badge">${naBase.length}</span>
        <span class="group__hint">Resolver internamente — não há a quem cobrar.</span>
      </div>
      <div class="fechamento-lista">
        ${naBase.map((p) => linhaInterna(p, atividades)).join("")}
      </div>
    </section>` : ""}

    <div class="charge" style="margin-top:26px">
      <div class="charge__actions">
        <button class="btn btn--primary" id="btnResumoFechamento">Gerar resumo do dia</button>
        <button class="btn btn--ghost" id="btnCopiarResumo" disabled>Copiar</button>
        <span class="hint" id="fechamentoHint">Resumo geral para o grupo da operação.</span>
      </div>
      <textarea class="charge__text" id="resumoFechamento" readonly hidden
                placeholder="O resumo do dia aparecerá aqui."></textarea>
    </div>`;
}

// ---------------------------------------------------------------------------

function agruparPorMotorista(circuito, byDriver, contatos, atividades) {
  const mapa = new Map();
  for (const p of circuito) {
    if (!p.motoristaAtual) continue;
    if (!mapa.has(p.motoristaAtual)) mapa.set(p.motoristaAtual, { driver: p.motoristaAtual, pacotes: [] });
    mapa.get(p.motoristaAtual).pacotes.push(p);
  }
  return [...mapa.values()]
    .map((m) => ({
      ...m,
      temZap: telefoneValido(contatos[m.driver]?.telefone),
      pendentes: m.pacotes.filter((p) => !cobradoHoje(atividades, p.pkgId)).length,
      ultima: m.pacotes.map((p) => ultimaCobranca(atividades, p.pkgId))
        .filter(Boolean).sort((a, b) => new Date(b.em) - new Date(a.em))[0] ?? null,
      temAtrasado: m.pacotes.some((p) => p.situacao === SITUACAO.COM_MOTORISTA_ESTOURADO),
      temTicket: m.pacotes.some((p) => p.ticketAberto),
      // o motorista precisa existir em byDriver para gerar a mensagem
      existeNaCobranca: byDriver.some((d) => d.driver === m.driver),
    }))
    .sort((a, b) => (b.temTicket - a.temTicket) || (b.pendentes - a.pendentes) || (b.temAtrasado - a.temAtrasado));
}

function linhaMotorista(m) {
  const tom = m.temTicket ? "atrasado" : m.pendentes ? "galpao" : "ok";
  return `
    <div class="fech-row" style="${tomVars(tom)}">
      <span class="avatar">${escapeHtml(iniciais(m.driver))}</span>
      <div class="fech-row__body">
        <div class="fech-row__name">${m.temTicket ? "🔴 " : ""}${escapeHtml(m.driver)}</div>
        <div class="fech-row__meta">
          ${m.pacotes.length} pacote${m.pacotes.length > 1 ? "s" : ""} no circuito
          ${m.pendentes ? ` · <b style="color:var(--atrasado)">${m.pendentes} sem cobrança hoje</b>` : ""}
          ${m.ultima ? ` · cobrado ${dataHora(new Date(m.ultima.em).getTime())} por ${escapeHtml(m.ultima.autor)}` : ""}
        </div>
        <div class="fech-row__pkgs">
          ${m.pacotes.map((p) => `<span class="fech-pkg" data-pkg="${escapeHtml(p.pkgId)}">${p.ticketAberto ? "🔴 " : ""}${escapeHtml(p.pkgId)}</span>`).join("")}
        </div>
      </div>
      <button class="btn btn--zap btn--sm" data-fech-zap="${escapeHtml(m.driver)}"
              ${m.temZap && m.existeNaCobranca ? "" : "disabled"}
              title="${m.temZap ? "Cobrar atualização no JMS" : "Cadastre o WhatsApp na aba Motoristas"}">
        📲 Cobrar
      </button>
    </div>`;
}

function linhaInterna(p, atividades) {
  const feito = cobradoHoje(atividades, p.pkgId);
  return `
    <div class="fech-row" style="${tomVars(feito ? "ok" : "nabase")}">
      <div class="fech-row__body">
        <div class="fech-row__name">${p.ticketAberto ? "🔴 " : ""}${escapeHtml(p.pkgId)}</div>
        <div class="fech-row__meta">
          ${escapeHtml(p.situacaoLabel)} · parado há ${duracao(p.horasSemMovimento)}
        </div>
      </div>
      <button class="btn btn--ghost btn--sm" data-pkg="${escapeHtml(p.pkgId)}">Abrir</button>
    </div>`;
}

/**
 * O resumo que vai para o grupo da operação: o que sobrou, com quem, e o que
 * precisa ser atualizado no JMS antes de fechar o dia.
 */
export function mensagemFechamento(packages, atividades) {
  const circuito = noCircuito(packages);
  if (!circuito.length) return null;

  const l = [];
  const hoje = new Date().toLocaleDateString("pt-BR");
  l.push(`📦 FECHAMENTO DO DIA — ${hoje}`);
  l.push("");
  l.push(`Ainda temos ${circuito.length} pacote${circuito.length > 1 ? "s" : ""} da TikTok Shop no circuito.`);
  l.push(`Preciso da situação atual de cada um ATUALIZADA NO JMS antes de encerrarmos.`);
  l.push("");

  const porMotorista = new Map();
  const semMotorista = [];
  for (const p of circuito) {
    if (p.motoristaAtual) {
      if (!porMotorista.has(p.motoristaAtual)) porMotorista.set(p.motoristaAtual, []);
      porMotorista.get(p.motoristaAtual).push(p);
    } else semMotorista.push(p);
  }

  for (const [motorista, pacotes] of [...porMotorista.entries()].sort()) {
    l.push(`*${motorista}* — ${pacotes.length}`);
    for (const p of pacotes) {
      l.push(`• ${p.ticketAberto ? "🔴 " : ""}${p.pkgId} — com você há ${duracao(p.horasComMotorista)}`);
    }
    l.push("");
  }

  if (semMotorista.length) {
    l.push(`*Na base (sem motorista)* — ${semMotorista.length}`);
    for (const p of semMotorista) l.push(`• ${p.pkgId} — ${p.situacaoLabel}`);
    l.push("");
  }

  l.push(`Cada pacote precisa terminar em um destes três desfechos, registrado no JMS:`);
  l.push(`1) entregue;`);
  l.push(`2) devolvido ao galpão / à malha;`);
  l.push(`3) recebido em outra base.`);
  l.push("");
  l.push(`Enquanto não tiver um desses, o pacote continua contando como pendência aberta.`);
  l.push(`Me respondam com a situação de cada um, por favor.`);

  return l.join("\n");
}
