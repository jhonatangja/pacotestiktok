// ---------------------------------------------------------------------------
// ui/cliente.js — a fila de contato com o cliente.
//
// POR QUE ESTA TELA EXISTE
//
// Metade das ocorrências da operação é problema de endereço, e endereço errado
// não se resolve indo de novo: o motorista pode ir cinco vezes que não vai
// achar, e cada volta custa ~24h porque a rota sai uma vez por dia. Foi assim
// que a média chegou a 2,1 despachos por pacote.
//
// O que resolve é alguém falar com o cliente ANTES do próximo despacho. Isso já
// era feito, mas dependia de lembrar: não havia lista, não havia relógio, e o
// telefone era garimpado no JMS toda vez, do zero.
//
// A fila é atribuída sozinha: RVD 1 é do Samuel, RVD 2 é do Marcos. Ninguém
// precisa distribuir tarefa de manhã.
// ---------------------------------------------------------------------------

import { CAUSA_META, assistenteDaBase, apelidoDaBase } from "../config.js";
import { ultimoContato, contatadoHoje } from "../atividades.js";
import { telefoneValido, formatarTelefone } from "../contatos.js";
import { escapeHtml, tomVars, duracao, dataHora, iniciais } from "./format.js";
import { listaVazia } from "./cards.js";

const H = 3600000;

/**
 * Pacotes que dependem de uma conversa com o cliente para andar.
 *
 * Não é "todo pacote com ocorrência": erro de triagem, por exemplo, se resolve
 * devolvendo — ligar para o cliente ali não muda nada. Só entram as causas
 * marcadas com `exigeContato` em config.js.
 */
export function paraContatar(packages, agora = Date.now()) {
  return packages
    .filter((p) => !p.resolvido && p.causa && CAUSA_META[p.causa]?.exigeContato)
    .map((p) => ({
      ...p,
      responsavel: assistenteDaBase(p.baseResponsavel),
      // o relógio conta da ocorrência, não da entrada no circuito: é dali que
      // alguém precisa agir
      horasDesdeOcorrencia: p.ocorreuEm == null ? null
        : Math.round(((agora - p.ocorreuEm) / H) * 10) / 10,
    }));
}

export function renderCliente(el, packages, tratativas = {}, atividades = []) {
  const fila = paraContatar(packages)
    .sort((a, b) => (b.horasDesdeOcorrencia ?? 0) - (a.horasDesdeOcorrencia ?? 0));

  if (!fila.length) {
    el.innerHTML = listaVazia(
      "Nenhum pacote esperando contato com o cliente. Nada a ligar agora.", "☎️");
    return;
  }

  const pendentes = fila.filter((p) => !contatadoHoje(atividades, p.pkgId));
  const semTelefone = fila.filter((p) => !telefoneValido(tratativas[p.pkgId]?.telefoneCliente));

  // agrupado por quem responde: cada assistente vê a própria lista
  const porResponsavel = new Map();
  for (const p of fila) {
    const dono = p.responsavel ?? "Sem base definida";
    if (!porResponsavel.has(dono)) porResponsavel.set(dono, []);
    porResponsavel.get(dono).push(p);
  }

  el.innerHTML = `
    <div class="page-head">
      <h2>Falar com o cliente</h2>
      <p>Endereço errado não se resolve indo de novo — o pacote volta e custa mais um dia.
         Estes precisam de uma conversa antes do próximo despacho.</p>
    </div>

    <div class="stats" style="margin-bottom:22px">
      <div class="stat" style="--accent:var(--ocorrencia)">
        <span class="stat__value" style="color:var(--ocorrencia)">${fila.length}</span>
        <span class="stat__label">esperando contato</span>
      </div>
      <div class="stat" style="--accent:var(--atrasado)">
        <span class="stat__value" style="color:var(--atrasado)">${pendentes.length}</span>
        <span class="stat__label">sem tentativa hoje</span>
      </div>
      <div class="stat" style="--accent:var(--galpao)">
        <span class="stat__value" style="color:var(--galpao)">${semTelefone.length}</span>
        <span class="stat__label">sem telefone guardado</span>
      </div>
    </div>

    ${[...porResponsavel.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([dono, itens]) => secaoResponsavel(dono, itens, tratativas, atividades))
      .join("")}`;
}

// ---------------------------------------------------------------------------

function secaoResponsavel(dono, itens, tratativas, atividades) {
  const faltam = itens.filter((p) => !contatadoHoje(atividades, p.pkgId)).length;

  return `
    <section class="group" style="${tomVars(faltam ? "ocorrencia" : "ok")};margin-bottom:26px">
      <div class="group__head">
        <h3>${escapeHtml(dono)}</h3>
        <span class="group__badge">${itens.length}</span>
        ${faltam ? `<span class="group__extra">${faltam} sem tentativa hoje</span>` : ""}
        <span class="group__hint">${
          itens[0]?.baseResponsavel ? escapeHtml(apelidoDaBase(itens[0].baseResponsavel)) : ""}</span>
      </div>
      <div class="fechamento-lista">
        ${itens.map((p) => linha(p, tratativas[p.pkgId], atividades)).join("")}
      </div>
    </section>`;
}

function linha(p, t, atividades) {
  const telefone = t?.telefoneCliente ?? "";
  const ok = telefoneValido(telefone);
  const ultima = ultimoContato(atividades, p.pkgId);
  const feitoHoje = contatadoHoje(atividades, p.pkgId);
  const meta = CAUSA_META[p.causa] ?? {};

  return `
    <div class="cli-row" style="${tomVars(feitoHoje ? "ok" : "ocorrencia")}" data-cli="${escapeHtml(p.pkgId)}">
      <div class="cli-row__head">
        <div>
          <div class="cli-row__code">${p.ticketAberto ? "🔴 " : ""}${escapeHtml(p.pkgId)}</div>
          <div class="cli-row__meta">
            ${escapeHtml(p.destCity ?? "—")} ·
            <b>${escapeHtml(p.motivoAtual ?? meta.label ?? "")}</b>
            ${p.horasDesdeOcorrencia != null
              ? ` · registrado há <b>${duracao(p.horasDesdeOcorrencia)}</b>` : ""}
          </div>
          ${p.motoristaAtual ? `
          <div class="cli-row__meta">
            <span class="avatar avatar--mini">${escapeHtml(iniciais(p.motoristaAtual))}</span>
            está com ${escapeHtml(p.motoristaAtual)}
          </div>` : ""}
        </div>
        <span class="pill">${escapeHtml(meta.resumo ?? "contato")}</span>
      </div>

      <div class="cli-row__tel">
        <input class="input" type="tel" inputmode="numeric"
               data-tel-cliente="${escapeHtml(p.pkgId)}"
               placeholder="Telefone do cliente — consulte no JMS"
               value="${escapeHtml(ok ? formatarTelefone(telefone) : telefone)}" />
        <button class="btn btn--ghost btn--sm" data-salvar-tel="${escapeHtml(p.pkgId)}">Guardar</button>
        <button class="btn btn--zap btn--sm" data-zap-cliente="${escapeHtml(p.pkgId)}"
                ${ok ? "" : "disabled"} title="${ok ? "Abrir conversa no WhatsApp" : "Guarde o telefone primeiro"}">
          📲 WhatsApp
        </button>
      </div>

      <div class="cli-row__acoes">
        <button class="btn btn--sm btn--ok" data-contato-ok="${escapeHtml(p.pkgId)}">
          ☎️ Falei com o cliente
        </button>
        <button class="btn btn--sm btn--ghost" data-contato-falhou="${escapeHtml(p.pkgId)}">
          📵 Não consegui falar
        </button>
        <button class="btn btn--sm btn--ghost" data-pkg="${escapeHtml(p.pkgId)}">Abrir pacote</button>
        ${ultima ? `<span class="hint">${
          escapeHtml(ultima.tipo === "CONTATO_OK" ? "Falou" : "Tentou")
        } ${dataHora(new Date(ultima.em).getTime())} · ${escapeHtml(ultima.autor)}</span>` : ""}
      </div>

      ${!feitoHoje ? "" : `
      <div class="cli-row__ordem">Já houve tentativa hoje. ${escapeHtml(meta.ordem ?? "")}</div>`}
    </div>`;
}

/** Mensagem pronta para o cliente — curta, porque ninguém lê parágrafo no zap. */
export function mensagemCliente(p, enrichment = {}) {
  const e = enrichment[p.pkgId] ?? {};
  const nome = e.destinatario ? e.destinatario.split(/\s+/)[0] : null;
  const l = [];
  l.push(`Olá${nome ? `, ${nome}` : ""}! Aqui é da transportadora que está entregando o seu pedido da TikTok Shop.`);
  l.push("");
  l.push(`Pedido *${p.pkgId}*.`);
  l.push(`Nosso entregador não conseguiu concluir a entrega: *${p.motivoAtual ?? "problema no endereço"}*.`);
  l.push("");
  l.push(`Pode confirmar o endereço completo com ponto de referência, por favor? Assim colocamos na próxima rota.`);
  return l.join("\n");
}
