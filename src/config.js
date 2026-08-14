// ---------------------------------------------------------------------------
// config.js — dicionário da operação e parâmetros de SLA.
//
// Tudo que é "regra de negócio declarativa" mora aqui: nomes de colunas do JMS,
// tradução dos tipos de bipagem para fatos operacionais, e os limites de tempo.
// Nenhuma lógica — só dados. Trocar um SLA não deve exigir mexer em domain.js.
// ---------------------------------------------------------------------------

// Nomes exatos das colunas do export `扫描查询（单号）` do JMS.
// O resolvedor usa esses nomes primeiro e cai nas keywords se o JMS mudar o rótulo.
export const COLUMNS = [
  { key: "pkgId",         header: "Número de pedido JMS",              required: true,
    keywords: ["numero de pedido jms", "numero pedido", "pedido", "codigo"] },
  { key: "ts",            header: "Tempo de digitalização",            required: true,
    keywords: ["tempo de digitalizacao", "data digitalizacao", "hora scan", "scan time"] },
  { key: "rawType",       header: "Tipo de bipagem",                   required: true,
    keywords: ["tipo de bipagem", "tipo bipagem", "tipo scan", "evento"] },
  { key: "base",          header: "Base de escaneamento",              required: false,
    keywords: ["base de escaneamento", "base scan", "base"] },
  { key: "prevNext",      header: "Parada anterior ou próxima",        required: false,
    keywords: ["parada anterior ou proxima", "parada anterior", "proxima parada"] },
  { key: "scanner",       header: "Digitalizador",                     required: false,
    keywords: ["digitalizador", "operador", "quem bipou"] },
  // ATENÇÃO: este — e não `scanner` — é quem está com o pacote. Ver memória do projeto.
  { key: "courier",       header: "Correio de coleta ou entrega",      required: false,
    keywords: ["correio de coleta ou entrega", "correio", "motorista", "entregador"] },
  { key: "lote",          header: "Número do lote",                    required: false,
    keywords: ["numero do lote", "lote", "saco"] },
  { key: "viagem",        header: "Número do ID",                      required: false,
    keywords: ["numero do id", "viagem", "id viagem"] },
  { key: "problemType",   header: "Tipo problemático",                 required: false,
    keywords: ["tipo problematico", "motivo problema"] },
  { key: "problemDesc",   header: "Descrição de Pacote Problemático",  required: false,
    keywords: ["descricao de pacote problematico", "descricao problema"] },
  { key: "unshippedType", header: "Tipos de pacote não expedido",      required: false,
    keywords: ["tipos de pacote nao expedido", "pacote nao expedido"] },
  { key: "destCity",      header: "Município de Destino",              required: false,
    keywords: ["municipio de destino", "cidade destino", "cidade"] },
  { key: "destState",     header: "Estado da cidade de destino",       required: false,
    keywords: ["estado da cidade de destino", "uf destino"] },
  { key: "destBase",      header: "Base Destino",                      required: false,
    keywords: ["base destino"] },
  { key: "originBase",    header: "Base remetente",                    required: false,
    keywords: ["base remetente"] },
  { key: "orderSource",   header: "Origem do Pedido",                  required: false,
    keywords: ["origem do pedido", "marketplace", "embarcador"] },
  { key: "weight",        header: "Peso Faturado",                     required: false,
    keywords: ["peso faturado", "peso"] },
  { key: "destZip",       header: "CEP destino",                       required: false,
    keywords: ["cep destino"] },
  { key: "uploadedAt",    header: "Tempo de upload",                   required: false,
    keywords: ["tempo de upload", "upload"] },
];

// ---------------------------------------------------------------------------
// EMBARCADOR — de quem é o pacote
//
// A base entrega para vários embarcadores, e o código diz de quem é: tudo que
// começa com `999` é TikTok Shop, o resto é de outro. É uma regra da operação,
// não do JMS — e é ela que decide qual prazo cobrar.
//
// O export de escaneamento também traz `Origem do Pedido`, que NOMEIA o
// embarcador. Ela é usada como rótulo (para "Outros" não virar um saco sem
// nome), mas quem manda na classificação é o prefixo: a coluna vem vazia em
// parte das linhas, o código nunca.
// ---------------------------------------------------------------------------
export const PREFIXO_TIKTOK = "999";

export const EMBARCADOR = {
  TIKTOK: "TIKTOK",
  OUTROS: "OUTROS",
};

export const EMBARCADOR_META = {
  [EMBARCADOR.TIKTOK]: {
    label: "TikTok Shop", curto: "TikTok", icone: "🛍️", tom: "atrasado",
    // O que muda de verdade: TikTok é entrega no mesmo dia. Ver SLA_PADRAO.
    mesmoDia: true,
  },
  [EMBARCADOR.OUTROS]: {
    label: "Outros embarcadores", curto: "Outros", icone: "📦", tom: "transito",
    mesmoDia: false,
  },
};

export const ehTikTok = (pkgId) => String(pkgId ?? "").startsWith(PREFIXO_TIKTOK);

export const embarcadorDoCodigo = (pkgId) =>
  ehTikTok(pkgId) ? EMBARCADOR.TIKTOK : EMBARCADOR.OUTROS;

// Fatos operacionais — o vocabulário interno do sistema.
export const FACT = {
  COLETA:        "COLETA",
  RECEPCAO:      "RECEPCAO",
  LOTE:          "LOTE",
  SAIDA_HUB:     "SAIDA_HUB",
  CHEGADA_HUB:   "CHEGADA_HUB",
  RECEBIDO_BASE: "RECEBIDO_BASE",
  DESPACHO:      "DESPACHO",
  ENTREGA:       "ENTREGA",
  OCORRENCIA:    "OCORRENCIA",
  GALPAO:        "GALPAO",
  OUTRO:         "OUTRO",
};

export const STAGE = {
  COLETADO:      "COLETADO",
  TRANSITO:      "TRANSITO",
  BASE_FINAL:    "BASE_FINAL",
  COM_MOTORISTA: "COM_MOTORISTA",
  ENTREGUE:      "ENTREGUE",
  OCORRENCIA:    "OCORRENCIA",
  GALPAO:        "GALPAO",
  OUTRO:         "OUTRO",
};

// Tradução dos 12 tipos de bipagem observados. A chave é o `Tipo de bipagem`
// já normalizado (minúsculo, sem acento e sem pontuação), para tolerar as
// variações de grafia que o JMS produz.
export const SCAN_TYPES = {
  "coleta de encomenda":                       { fact: FACT.COLETA,        stage: STAGE.COLETADO,      label: "Coleta no remetente" },
  "bipe de recepcao":                          { fact: FACT.RECEPCAO,      stage: STAGE.COLETADO,      label: "Recepção na origem" },
  "coleta de chegadas":                        { fact: FACT.RECEPCAO,      stage: STAGE.COLETADO,      label: "Chegada no DC de coleta" },
  "encomenda inserida em lote":                { fact: FACT.LOTE,          stage: STAGE.TRANSITO,      label: "Inserido no lote" },
  "bipe de expedicao":                         { fact: FACT.SAIDA_HUB,     stage: STAGE.TRANSITO,      label: "Expedido" },
  "digitalizacao de carregamento":             { fact: FACT.SAIDA_HUB,     stage: STAGE.TRANSITO,      label: "Expedido" },
  "chegadas ao centro":                        { fact: FACT.CHEGADA_HUB,   stage: STAGE.TRANSITO,      label: "Chegada no centro" },
  "digitalizacao de descarga":                 { fact: FACT.CHEGADA_HUB,   stage: STAGE.TRANSITO,      label: "Chegada no centro" },
  "bipe de recebimento":                       { fact: FACT.RECEBIDO_BASE, stage: STAGE.BASE_FINAL,    label: "Recebido na base final" },
  "bipe de saida para entrega":                { fact: FACT.DESPACHO,      stage: STAGE.COM_MOTORISTA, label: "Saiu para entrega" },
  // A baixa da entrega. É o único evento do JMS que encerra o pacote sozinho e
  // em definitivo — o cliente assinou, acabou. Não depende de decisão da base.
  "assinatura de encomenda":                   { fact: FACT.ENTREGA,       stage: STAGE.ENTREGUE,      label: "Entregue ao cliente" },
  "bipe de pacote problematico":               { fact: FACT.OCORRENCIA,    stage: STAGE.OCORRENCIA,    label: "Ocorrência registrada" },
  "entrada no galpao de pacote nao expedido":  { fact: FACT.GALPAO,        stage: STAGE.GALPAO,        label: "Retornou ao galpão" },
};

// Fatos que descrevem o MESMO acontecimento físico e precisam ser colapsados.
// O JMS grava chegada e descarga (e expedição e carregamento) no mesmo segundo,
// e ainda repete o bipe por equipamento e por humano.
export const FACT_GROUP = {
  [FACT.CHEGADA_HUB]:   "ARRIVAL",
  [FACT.RECEBIDO_BASE]: "ARRIVAL",
  [FACT.SAIDA_HUB]:     "DEPARTURE",
};

// Quando dois fatos do mesmo grupo colidem, o de maior peso vence.
// `bipe de recebimento` é mais informativo que `Digitalização de descarga`.
export const FACT_WEIGHT = {
  [FACT.RECEBIDO_BASE]: 100,
  [FACT.CHEGADA_HUB]:   10,
  [FACT.SAIDA_HUB]:     10,
};

// Desempate quando dois fatos distintos caem no mesmo timestamp.
export const FACT_ORDER = [
  FACT.COLETA, FACT.RECEPCAO, FACT.LOTE, FACT.CHEGADA_HUB, FACT.RECEBIDO_BASE,
  FACT.SAIDA_HUB, FACT.DESPACHO, FACT.OCORRENCIA, FACT.GALPAO, FACT.ENTREGA, FACT.OUTRO,
];

export const DEDUPE = {
  // Dois despachos do MESMO motorista dentro dessa janela são o mesmo despacho
  // (clique duplo do conferente: 10:00:05 e 10:00:11).
  despachoMs: 15 * 60 * 1000,
  // Demais fatos: equipamento e humano bipando o mesmo evento com segundos de diferença.
  genericoMs: 2 * 60 * 1000,
};

// As três saídas legítimas de um pacote que está com motorista — as mesmas três
// que a cobrança enuncia. Qualquer outro desfecho é pendência, em especial o
// rebipe sem tratativa.
//
// `assinatura de encomenda` é a mais forte das três: encerra o despacho E o
// pacote. As outras duas só encerram o despacho.
export const FECHAMENTOS = [FACT.ENTREGA, FACT.OCORRENCIA, FACT.GALPAO];

export const SLA_PADRAO = {
  // O PRAZO QUE VALE PARA TUDO: 1 dia contado do `bipe de recebimento` na base.
  //
  // É o compromisso com o cliente, e vale para qualquer embarcador — não é o
  // relógio do motorista nem o da expedição, que medem pedaços do caminho.
  // Enquanto os outros dizem "quem está devendo o quê", este diz uma coisa só:
  // este pacote ainda dá para cumprir, ou já falhou?
  entregaHoras: 24,

  // Despacho aberto além disso = motorista estourou o prazo.
  // 8h = uma jornada. Definido pelo usuário em 06/08/2026.
  posseMotoristaHoras: 8,
  // Tempo entre receber o pacote e registrar a ocorrência.
  registroOcorrenciaHoras: 4,
  // Recebido na base e ainda não despachado. O prazo depende de ONDE o pacote
  // vai entregar — ver `CIDADE_BASE` abaixo.
  expedicaoCidadeBaseHoras: 6,
  expedicaoInteriorHoras: 48,
  // Nenhum evento de nenhum tipo nesse intervalo = pacote sumiu do radar.
  semMovimentoHoras: 24,
};

// A cidade onde a base fica.
//
// Pacote daqui sai na rota do mesmo dia: se ficou parado, é esquecimento.
// Pacote de interior espera a viagem daquela cidade: ficar parado é o normal.
//
// Os números provaram isso na base real (08/08/2026): Rio Verde levava 48,4h em
// média para sair, contra 23,6h do interior — o que está na porta demorava o
// DOBRO do que precisa esperar viagem. Um SLA único de 12h para os dois era
// ruído para o interior e chegava tarde demais para a cidade base.
export const CIDADE_BASE = "Rio Verde";

const chaveCidade = (c) =>
  String(c ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();

const CIDADE_BASE_NORM = chaveCidade(CIDADE_BASE);

export const ehCidadeBase = (cidade) => chaveCidade(cidade) === CIDADE_BASE_NORM;

/** O prazo de expedição que vale para este destino. */
export const slaExpedicao = (cidade, sla = SLA_PADRAO) =>
  ehCidadeBase(cidade) ? sla.expedicaoCidadeBaseHoras : sla.expedicaoInteriorHoras;

export const PREFIXO_MOTORISTA_PADRAO = "F RVD -";

// Contas de "motorista" usadas para TRATATIVA DENTRO DA BASE.
//
// No JMS o bipe sai idêntico ao de um despacho de verdade, com o nome da conta
// no lugar de quem realmente responde. Só que o pacote não foi para a rua: ele
// está na base, e quem responde por ele é o assistente daquela base.
//
// Esconder a conta não resolve — deixaria o cartão apontando o motorista do
// despacho ANTERIOR, ou seja, cobrando a pessoa errada. O certo é traduzir a
// conta para o assistente responsável.
//
// Para incluir outra conta: `"NOME DA CONTA NO JMS": "ASSISTENTE"` (sem o
// prefixo da filial). A comparação ignora acento e maiúscula.
export const CONTAS_DE_TRATATIVA = {
  "SAMARA KELLIS PEREIRA DOS SANTOS": "SAMUEL RVD 1",
  "DIONATAN DOS SANTOS":              "MARCOS RVD 2",
};

const semAcento = (s) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();

const POR_CONTA = new Map(
  Object.entries(CONTAS_DE_TRATATIVA).map(([conta, resp]) => [semAcento(conta), resp]));

/** O assistente que responde por essa conta, ou null se for motorista de rua. */
export const responsavelDaConta = (nome) => POR_CONTA.get(semAcento(nome)) ?? null;

/** O nome é uma conta de tratativa da base, e não um motorista de rua? */
export const ehContaDeTratativa = (nome) => responsavelDaConta(nome) != null;

// TikTok Shop é entrega no mesmo dia: todo pacote que ainda está no circuito
// tem um cliente esperando AGORA. Por isso a cobrança não separa mais "com
// reclamação" de "sem reclamação" — todos são cobrados como cliente aguardando.
export const CLIENTE_AGUARDANDO_SEMPRE = true;

// Hora de corte da cobrança. Antes disso o pacote é cobrado para HOJE; a partir
// dela, para a primeira rota de amanhã — exigir entrega às 17h só produz uma
// promessa que ninguém cumpre, e uma promessa quebrada não cobra ninguém.
export const CORTE_ENTREGA_HOJE = 14;

// A base que esta operação responde. Serve para reconhecer quando um pacote
// foi recebido POR OUTRA base — momento em que ele sai da sua responsabilidade.
export const BASE_OPERACAO = "F RVD - GO";

// A operação tem MAIS DE UMA base em Rio Verde. Um `bipe de recebimento` numa
// delas não tira o pacote do circuito — só muda de quem é a responsabilidade.
// Só um recebimento numa base FORA desta lista encerra o caso aqui.
//
// A primeira da lista é a base principal (`BASE_OPERACAO`).
export const BASES_OPERACAO = [
  "F RVD - GO",
  "F RVD 02-GO",
];

// Como cada base é chamada na tela. Sem isso o operador lê "F RVD 02-GO" e
// precisa lembrar de cabeça qual é qual.
export const BASE_APELIDO = {
  "F RVD - GO":  "RVD 1",
  "F RVD 02-GO": "RVD 2",
};

const chaveBase = (b) => String(b ?? "").trim().toUpperCase().replace(/\s+/g, " ");
const BASES_NORMALIZADAS = new Set(BASES_OPERACAO.map(chaveBase));

/** A base é uma das nossas? Sem nome informado, assume que sim. */
export const ehBasePropria = (b) => !b || BASES_NORMALIZADAS.has(chaveBase(b));

/** "F RVD 02-GO" → "RVD 2". Cai no nome cru quando não houver apelido. */
export const apelidoDaBase = (b) => BASE_APELIDO[String(b ?? "").trim()] ?? b ?? null;

export const SITUACAO = {
  ENTREGUE:                "ENTREGUE",
  RECEBIDO_OUTRA_BASE:     "RECEBIDO_OUTRA_BASE",
  RETORNADO_GALPAO:        "RETORNADO_GALPAO",
  COM_MOTORISTA_ESTOURADO: "COM_MOTORISTA_ESTOURADO",
  COM_MOTORISTA_NO_PRAZO:  "COM_MOTORISTA_NO_PRAZO",
  EM_TRATATIVA_BASE:       "EM_TRATATIVA_BASE",
  OCORRENCIA_EM_ABERTO:    "OCORRENCIA_EM_ABERTO",
  NA_BASE_NAO_EXPEDIDO:    "NA_BASE_NAO_EXPEDIDO",
  EM_TRANSITO:             "EM_TRANSITO",
};

// Rótulo, ação necessária e peso de criticidade — consumidos pelo Painel de Ação.
// TikTok Shop é entrega no mesmo dia: um pacote que está com motorista É uma
// pendência viva, mesmo tendo saído há pouco. Por isso "no prazo" também cai
// em "Cobrar motorista" — o prazo muda a cor, não a necessidade de cobrar.
export const SITUACAO_META = {
  // Terminal e definitivo: o cliente assinou. Nada a cobrar de ninguém.
  [SITUACAO.ENTREGUE]:                { label: "Entregue ao cliente",      acao: "Encerrado",         peso: 0 },
  // Terminal: outra base assumiu o pacote, então ele saiu do seu circuito.
  [SITUACAO.RECEBIDO_OUTRA_BASE]:     { label: "Recebido em outra base",   acao: "Encerrado",         peso: 0 },
  [SITUACAO.RETORNADO_GALPAO]:        { label: "Retornou ao galpão",       acao: "Tratar no galpão",  peso: 100 },
  [SITUACAO.COM_MOTORISTA_ESTOURADO]: { label: "Com motorista (atrasado)", acao: "Cobrar motorista",  peso: 90 },
  // Bipado para uma conta de tratativa: o pacote está na base, não na rua.
  // Não há motorista a cobrar — quem resolve é a equipe daqui.
  [SITUACAO.EM_TRATATIVA_BASE]:       { label: "Em tratativa na base",     acao: "Tratar na base",    peso: 85 },
  [SITUACAO.OCORRENCIA_EM_ABERTO]:    { label: "Ocorrência sem desfecho",  acao: "Definir destino",   peso: 80 },
  [SITUACAO.NA_BASE_NAO_EXPEDIDO]:    { label: "Parado na base",           acao: "Expedir da base",   peso: 70 },
  [SITUACAO.COM_MOTORISTA_NO_PRAZO]:  { label: "Com motorista (no prazo)", acao: "Cobrar motorista",  peso: 40 },
  [SITUACAO.EM_TRANSITO]:             { label: "Em trânsito",              acao: "Monitorar",         peso: 20 },
};

// ---------------------------------------------------------------------------
// A CAUSA DA OCORRÊNCIA — e a ordem que ela exige
//
// O sistema tinha uma resposta só para tudo: "entregue hoje". Só que num pacote
// com endereço incorreto o motorista pode ir cinco vezes que não vai achar, e
// cada volta custa mais 24h. Foi assim que a média chegou a 2,1 despachos por
// pacote: ninguém nunca disse a ele para PARAR de tentar.
//
// Na amostra real de 08/08/2026, das 50 ocorrências registradas: 24 eram de
// endereço (incorreto, mudou, impossível chegar) e 10 de erro de triagem —
// pacote de cidade que a base não atende, que nem deveria ser tentado.
// ---------------------------------------------------------------------------
export const CAUSA = {
  ENDERECO:     "ENDERECO",
  FORA_DA_AREA: "FORA_DA_AREA",
  AUSENCIA:     "AUSENCIA",
  OUTRA:        "OUTRA",
};

// `Tipo problemático` do JMS → causa. A chave é o texto normalizado.
export const CAUSA_POR_MOTIVO = {
  "endereco incorreto":                          CAUSA.ENDERECO,
  "destinatario mudou de endereco":              CAUSA.ENDERECO,
  "impossibilidade de chegar no endereco informado": CAUSA.ENDERECO,
  "erro de triagem":                             CAUSA.FORA_DA_AREA,
  "envio errado":                                CAUSA.FORA_DA_AREA,
  "ausencia do destinatario":                    CAUSA.AUSENCIA,
};

// Quem liga para o cliente quando o motorista não resolve na rua. É o
// assistente da base que responde pelo pacote — definido pela operação.
export const ASSISTENTE_DA_BASE = {
  "F RVD - GO":  "SAMUEL RVD 1",
  "F RVD 02-GO": "MARCOS RVD 2",
};

export const assistenteDaBase = (base) =>
  ASSISTENTE_DA_BASE[String(base ?? "").trim()] ?? null;

export const CAUSA_META = {
  [CAUSA.ENDERECO]: {
    label: "Endereço com problema",
    // Endereço errado não se resolve indo de novo: alguém precisa falar com o
    // cliente. Fora da área, não — aquilo se resolve devolvendo.
    exigeContato: true,
    // O que a operação definiu: tentar contato e, não conseguindo, devolver.
    // Sair de novo com o mesmo endereço errado é o que precisa parar.
    ordem: "Não saia com ele de novo no mesmo endereço. Tente contato com o cliente pelo aplicativo e, se não conseguir falar, devolva ao galpão HOJE.",
    resumo: "contato ou devolução hoje",
  },
  [CAUSA.FORA_DA_AREA]: {
    label: "Fora da área de entrega",
    exigeContato: false,
    ordem: "Não tente entregar — não é cidade que a gente atende. Devolva ao galpão HOJE para voltar para a malha.",
    resumo: "devolver, sem tentar",
  },
  [CAUSA.AUSENCIA]: {
    label: "Cliente ausente",
    exigeContato: true,
    ordem: "Combine um horário com o cliente pelo aplicativo antes de ir de novo. Sem horário combinado, devolva ao galpão HOJE.",
    resumo: "combinar horário",
  },
};

export const FLAG = {
  PRAZO_ESTOURADO:      "PRAZO_ESTOURADO",
  TICKET_CLIENTE:       "TICKET_CLIENTE",
  REBIPE_SEM_TRATATIVA: "REBIPE_SEM_TRATATIVA",
  TROCA_DE_MOTORISTA:   "TROCA_DE_MOTORISTA",
  OCORRENCIA_LENTA:     "OCORRENCIA_LENTA",
  PARADO_NA_BASE:       "PARADO_NA_BASE",
  SEM_MOVIMENTO:        "SEM_MOVIMENTO",
  REINCIDENTE:          "REINCIDENTE",
  MOVIMENTO_APOS_RESOLVIDA: "MOVIMENTO_APOS_RESOLVIDA",
};

export const FLAG_META = {
  // O prazo com o cliente já passou. Pesa mais que qualquer outra coisa porque
  // não é risco de falhar — é falha consumada, e cada hora a mais é dano.
  [FLAG.PRAZO_ESTOURADO]:      { label: "Fora do prazo de entrega", peso: 140,
    hint: "Passou de 24h desde o recebimento na base. O compromisso com o cliente já foi quebrado." },
  // O cliente já reclamou na TikTok Shop. Não é um alerta derivado dos bipes —
  // é marcado à mão pela operação, e vale mais que qualquer prazo.
  [FLAG.TICKET_CLIENTE]:       { label: "Ticket do cliente", peso: 120,
    hint: "Cliente abriu reclamação na TikTok Shop. Prioridade máxima, independente do prazo." },
  [FLAG.REBIPE_SEM_TRATATIVA]: { label: "Rebipe sem tratativa", peso: 50,
    hint: "Saiu de novo com motorista sem ocorrência, entrega ou retorno ao galpão." },
  [FLAG.TROCA_DE_MOTORISTA]:   { label: "Trocou de motorista",  peso: 30,
    hint: "Passou de um motorista para outro sem nenhuma baixa no meio." },
  [FLAG.OCORRENCIA_LENTA]:     { label: "Ocorrência tardia",    peso: 25,
    hint: "Demorou além do limite para registrar a problemática." },
  [FLAG.PARADO_NA_BASE]:       { label: "Ficou parado na base", peso: 20,
    hint: "Recebido na base e não despachado dentro do prazo — gargalo interno." },
  [FLAG.SEM_MOVIMENTO]:        { label: "Sem movimento",        peso: 35,
    hint: "Nenhum bipe de nenhum tipo no período." },
  [FLAG.REINCIDENTE]:          { label: "Reincidente",          peso: 15,
    hint: "Duas ou mais ocorrências no mesmo pacote." },
  // Impede que um pacote fique enterrado em "Resolvidos" depois de voltar
  // a se mover — exatamente a tratativa esquecida que o sistema evita.
  [FLAG.MOVIMENTO_APOS_RESOLVIDA]: { label: "Voltou a se mover", peso: 45,
    hint: "Foi dado como resolvido, mas recebeu bipe novo depois. Voltou para a fila." },
};
