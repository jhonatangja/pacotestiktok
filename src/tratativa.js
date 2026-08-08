// ---------------------------------------------------------------------------
// tratativa.js — regras da tratativa.
//
// A tratativa é o único dado do sistema que NÃO vem do Excel: responsável,
// prazo, status e o registro do que foi tentado. É por isso que ela nunca é
// tocada pela importação — ver repo.js.
//
// O que garante que nada seja esquecido não é a existência do registro, é o
// envelhecimento dele: um pacote no galpão sem dono, ou com prazo vencido,
// sobe sozinho na fila.
// ---------------------------------------------------------------------------

export const STATUS = {
  ABERTA:      "aberta",
  EM_ANDAMENTO: "em_andamento",
  RESOLVIDA:   "resolvida",
};

export const STATUS_META = {
  [STATUS.ABERTA]:       { label: "Aberta",       tom: "atrasado" },
  [STATUS.EM_ANDAMENTO]: { label: "Em andamento", tom: "galpao" },
  [STATUS.RESOLVIDA]:    { label: "Resolvida",    tom: "ok" },
};

/**
 * Como o pacote saiu do circuito. O JMS não traz a baixa, então quem fecha é
 * a operação — e precisa dizer COMO fechou, senão "resolvido" vira um saco
 * onde cabe qualquer coisa.
 */
export const DESFECHO = {
  ENTREGUE:  "entregue",
  DEVOLVIDO: "devolvido",
};

export const DESFECHO_META = {
  [DESFECHO.ENTREGUE]:  { label: "Entregue",  icone: "✅", tom: "ok",
                          hint: "Chegou ao destinatário." },
  [DESFECHO.DEVOLVIDO]: { label: "Devolvido", icone: "↩️", tom: "nabase",
                          hint: "Voltou para a malha — devolvido ao remetente ou a outra base." },
};

export function novaTratativa(pkgId) {
  return {
    pkgId,
    responsavel: "",
    prazo: null,          // "YYYY-MM-DD"
    status: STATUS.ABERTA,
    ticket: null,         // { aberto, ref, em } — reclamação do cliente na TikTok Shop
    // O telefone do destinatário não vem em planilha nenhuma: quem precisa dele
    // consulta o pacote no JMS. Guardar aqui faz essa consulta acontecer UMA vez
    // — sem isso, a próxima pessoa garimpa o mesmo número de novo.
    telefoneCliente: "",
    notas: [],
    criadaEm: new Date().toISOString(),
    atualizadaEm: new Date().toISOString(),
  };
}

/**
 * O cliente abriu reclamação na TikTok Shop. Este dado não existe em planilha
 * nenhuma — vem da plataforma e é marcado à mão. Uma vez marcado, o pacote vira
 * prioridade máxima independente de quanto tempo faz que saiu.
 */
export function temTicket(t) {
  return !!t?.ticket?.aberto && t.status !== STATUS.RESOLVIDA;
}

export function alternarTicket(t, ref = "") {
  const aberto = !t?.ticket?.aberto;
  return {
    ...t,
    ticket: aberto ? { aberto: true, ref: String(ref).trim(), em: new Date().toISOString() } : null,
    atualizadaEm: new Date().toISOString(),
  };
}

const DIA = 86400000;
const meiaNoite = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * Estado derivado da tratativa em relação ao tempo.
 * `semDono` é o mais importante: é literalmente o pacote esquecido.
 */
export function situacaoTratativa(t, agora = Date.now()) {
  if (!t) return { estado: "SEM_TRATATIVA", tom: "atrasado", label: "Sem tratativa", urgencia: 100 };
  if (t.status === STATUS.RESOLVIDA) {
    return { estado: "RESOLVIDA", tom: "ok", label: "Resolvida", urgencia: 0 };
  }

  const semDono = !String(t.responsavel ?? "").trim();
  if (semDono) return { estado: "SEM_DONO", tom: "atrasado", label: "Sem responsável", urgencia: 90 };

  if (t.prazo) {
    const diasRestantes = Math.round((meiaNoite(new Date(t.prazo + "T00:00:00")) - meiaNoite(new Date(agora))) / DIA);
    if (diasRestantes < 0) {
      return { estado: "VENCIDA", tom: "atrasado", urgencia: 80,
               label: `Prazo vencido há ${Math.abs(diasRestantes)}d` };
    }
    if (diasRestantes === 0) {
      return { estado: "VENCE_HOJE", tom: "galpao", label: "Vence hoje", urgencia: 60 };
    }
    return { estado: "NO_PRAZO", tom: "nabase", urgencia: 20,
             label: `Vence em ${diasRestantes}d` };
  }

  return { estado: "SEM_PRAZO", tom: "galpao", label: "Sem prazo definido", urgencia: 50 };
}

/** Quantos dias o pacote está no galpão sem desfecho. */
export function diasNoGalpao(pacote, agora = Date.now()) {
  return Math.floor((agora - pacote.ultimoEventoEm) / DIA);
}

/**
 * Ordena a fila do galpão: primeiro quem corre risco de ser esquecido,
 * depois quem está no galpão há mais tempo.
 */
export function ordenarFila(pacotes, tratativas, agora = Date.now()) {
  return [...pacotes].sort((a, b) => {
    const ua = situacaoTratativa(tratativas[a.pkgId], agora).urgencia;
    const ub = situacaoTratativa(tratativas[b.pkgId], agora).urgencia;
    return ub - ua || b.horasSemMovimento - a.horasSemMovimento;
  });
}

/**
 * Separa uma colagem de códigos. Aceita quebra de linha, vírgula, ponto e
 * vírgula, tabulação ou espaço — o operador cola do jeito que vier da TikTok
 * Shop, não do jeito que o sistema preferiria.
 */
export function separarCodigos(texto) {
  return [...new Set(
    String(texto ?? "")
      .split(/[\s,;|]+/)
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean)
  )];
}

export function adicionarNota(t, texto, autor = "") {
  const nota = { texto: String(texto).trim(), autor, em: new Date().toISOString() };
  if (!nota.texto) return t;
  return { ...t, notas: [...(t.notas ?? []), nota], atualizadaEm: nota.em };
}
