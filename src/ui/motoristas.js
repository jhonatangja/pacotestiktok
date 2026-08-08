// ---------------------------------------------------------------------------
// ui/motoristas.js — o cadastro de motoristas.
//
// Um lugar central para o "banco de motoristas": todo mundo que já apareceu
// num pacote, mais quem você cadastrar à mão antes mesmo de ter pacote. O
// telefone fica guardado uma vez e serve à cobrança de um clique em qualquer
// tela. Persistido como contato no repositório (local ou nuvem).
// ---------------------------------------------------------------------------

import { ehContaDeTratativa } from "../config.js";
import { escapeHtml, iniciais, tomVars } from "./format.js";
import { telefoneValido, formatarTelefone } from "../contatos.js";
import { listaVazia } from "./cards.js";

/**
 * Reúne todos os motoristas conhecidos: os que têm pacote agora (byDriver),
 * os que já apareceram em algum pacote (histórico) e os cadastrados à mão.
 * Devolve a lista ordenada — quem tem pendência aberta primeiro.
 */
export function listarMotoristas(packages, byDriver, contatos) {
  const mapa = new Map();
  const slot = (nome) => {
    if (!mapa.has(nome)) {
      mapa.set(nome, { driver: nome, abertos: 0, historico: 0, cadastrado: false });
    }
    return mapa.get(nome);
  };

  for (const p of packages) {
    // `motoristasEnvolvidos` já exclui as contas de tratativa da base: elas não
    // são pessoas, não têm WhatsApp e não podem virar linha do cadastro.
    for (const nome of p.motoristasEnvolvidos) slot(nome).historico++;
  }
  for (const m of byDriver) slot(m.driver).abertos = m.totalAbertos;
  for (const nome of Object.keys(contatos)) {
    if (!ehContaDeTratativa(nome)) slot(nome).cadastrado = true;
  }

  return [...mapa.values()]
    .map((m) => ({ ...m, telefone: contatos[m.driver]?.telefone ?? "" }))
    .sort((a, b) =>
      b.abertos - a.abertos ||
      b.historico - a.historico ||
      a.driver.localeCompare(b.driver));
}

export function contarMotoristas(packages, byDriver, contatos) {
  return listarMotoristas(packages, byDriver, contatos).length;
}

export function renderMotoristas(el, packages, byDriver, contatos, filtro = "") {
  const todos = listarMotoristas(packages, byDriver, contatos);
  const comContato = todos.filter((m) => telefoneValido(m.telefone)).length;

  const termo = filtro.trim().toLowerCase();
  const lista = termo
    ? todos.filter((m) => m.driver.toLowerCase().includes(termo))
    : todos;

  el.innerHTML = `
    <div class="stats" style="margin-bottom:20px">
      <div class="stat" style="--accent:var(--navy)">
        <span class="stat__value">${todos.length}</span>
        <span class="stat__label">motoristas</span>
      </div>
      <div class="stat" style="--accent:var(--ok)">
        <span class="stat__value" style="color:var(--ok)">${comContato}</span>
        <span class="stat__label">com WhatsApp cadastrado</span>
      </div>
      <div class="stat" style="--accent:var(--atrasado)">
        <span class="stat__value" style="color:var(--atrasado)">${todos.length - comContato}</span>
        <span class="stat__label">sem contato</span>
      </div>
    </div>

    <div class="motorista-novo">
      <span class="motorista-novo__label">Cadastrar motorista</span>
      <div class="motorista-novo__row">
        <input class="input" id="novoMotoristaNome" placeholder="Nome do motorista" />
        <input class="input" id="novoMotoristaTel" inputmode="tel" placeholder="WhatsApp com DDD" />
        <button class="btn btn--primary" id="btnAddMotorista">Adicionar</button>
      </div>
    </div>

    <div class="toolbar">
      <input type="search" id="buscaMotorista" class="input input--search"
             placeholder="Buscar motorista…" value="${escapeHtml(filtro)}" />
    </div>

    ${lista.length
      ? `<div class="cards">${lista.map(card).join("")}</div>`
      : listaVazia(termo ? "Nenhum motorista encontrado." : "Nenhum motorista ainda. Importe uma planilha ou cadastre acima.", "🧑‍✈️")}`;
}

function card(m) {
  const zapOk = telefoneValido(m.telefone);
  const tom = m.abertos ? "atrasado" : zapOk ? "ok" : "transito";

  return `
    <div class="motorista" style="${tomVars(tom)}" data-motorista="${escapeHtml(m.driver)}">
      <div class="motorista__head">
        <span class="avatar">${escapeHtml(iniciais(m.driver))}</span>
        <div class="motorista__id">
          <div class="motorista__name">${escapeHtml(m.driver)}</div>
          <div class="motorista__meta">
            ${m.abertos ? `<b style="color:var(--atrasado)">${m.abertos} em aberto</b> · ` : ""}${m.historico} pacote${m.historico === 1 ? "" : "s"} no histórico
          </div>
        </div>
      </div>

      <div class="motorista__contact">
        <input class="input" data-tel="${escapeHtml(m.driver)}" inputmode="tel"
               placeholder="WhatsApp com DDD"
               value="${escapeHtml(zapOk ? formatarTelefone(m.telefone) : m.telefone)}" />
        <button class="btn btn--ghost btn--sm" data-salvar="${escapeHtml(m.driver)}">Salvar</button>
      </div>

      <div class="motorista__actions">
        <button class="btn btn--zap btn--sm" data-zap="${escapeHtml(m.driver)}" ${zapOk && m.abertos ? "" : "disabled"}>
          📲 Cobrar${m.abertos ? ` (${m.abertos})` : ""}
        </button>
        ${zapOk ? `<button class="btn btn--ghost btn--sm btn--danger" data-remover="${escapeHtml(m.driver)}">Remover contato</button>` : ""}
      </div>
    </div>`;
}
