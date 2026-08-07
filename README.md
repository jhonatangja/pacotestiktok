# Controle de Pacotes · TikTok Shop

Sistema interno da base **F RVD - GO** (Rio Verde/GO) para transformar o log bruto de
escaneamento do JMS em fila de ação: quem cobrar agora, o que tratar no galpão e o que
não pode ser esquecido.

## A regra que o sistema existe para vigiar

Um pacote sob posse de motorista só tem **três saídas legítimas**:

1. registrar a problemática;
2. finalizar a entrega;
3. devolver ao galpão.

Qualquer outro desfecho é pendência. O caso mais grave — e invisível no JMS — é o
**rebipe sem tratativa**: o pacote recebe um novo `bipe de saída para entrega` sem que
nenhuma das três saídas tenha acontecido antes. Ele roda dia após dia parecendo normal
enquanto o motorista o carrega sem prestar contas.

Na amostra de 06/08/2026 isso atingia **3 de 9 pacotes** (até 72h de posse silenciosa).

TikTok Shop é entrega no mesmo dia, então **todo pacote que está com motorista é
pendência viva** — mesmo o que saiu há uma hora. O prazo de 8h muda a cor do cartão,
não a necessidade de cobrar.

## O relógio da base

A idade de um pacote conta a partir do `bipe de recebimento` — quando ele chega em
F RVD - GO. O tempo de trânsito nacional que veio antes não é responsabilidade daqui,
e por isso não entra nem no cartão nem no cálculo de prioridade: um pacote que demorou
4 dias para chegar mas chegou hoje não é mais urgente que outro parado aqui há 3 dias.

A data de coleta continua visível no detalhe do pacote, como contexto.

## Ticket do cliente

Quando o cliente abre reclamação na TikTok Shop, marque o ticket no pacote. É o único
sinal do sistema que não vem de planilha nenhuma — vem da plataforma, e é marcado à mão.

Duas formas de lançar:

- **Em lote**, pelo campo no topo do Painel de Ação: cole a lista de códigos como ela
  vier (uma por linha, vírgula, tabulação ou espaço), Enter marca. O mesmo campo remove.
- **Um a um**, pelo botão no topo do detalhe do pacote — é aí que dá para guardar o
  número do protocolo.

Código que ainda não foi importado **não é descartado**: o ticket fica guardado e passa
a valer sozinho quando o pacote aparecer numa importação futura. A reclamação do cliente
quase sempre chega antes do bipe.

Um pacote com ticket:

- vira o **primeiro da fila**, num nível acima de tudo (não é peso somado — um pacote
  velho o suficiente acabaria passando na frente se fosse);
- ganha um grupo próprio no topo do Painel de Ação;
- sai destacado e em seção separada na mensagem de cobrança, com o número do protocolo;
- puxa o motorista para o topo da fila de cobrança.

Marcar a tratativa como **resolvida** encerra o ticket automaticamente.

## Como rodar

**Duplo clique em `abrir.bat`.** Ele sobe um servidor local e abre o navegador.
Para desligar, feche a janela minimizada "Servidor - Controle de Pacotes".

> **Não abra o `index.html` com duplo clique.** O navegador bloqueia módulos
> JavaScript *e* o IndexedDB quando a página vem de um arquivo solto (`file://`):
> a tela carrega mas nada funciona e nada é salvo. O app precisa de `http://`.

Se preferir subir na mão, qualquer servidor estático serve:

```bash
npx serve -l 4173 .
```

Validar o motor contra a planilha real (roda em Node, sem navegador):

```bash
node tools/validate.js
```

## Fluxo de uso

1. **Importar** — envie o export `扫描查询（单号）` ("Consulta de escaneamento por número
   de pedido") do JMS. Cada importação soma ao histórico; reenviar o mesmo arquivo não
   duplica nada e nunca apaga tratativas.
2. **Painel de Ação** — as pendências agrupadas pela ação que exigem.
3. **Cobrança** — por motorista, com mensagem de WhatsApp pronta citando as três saídas.
   Cadastre o WhatsApp do motorista uma vez e o botão **📲 Cobrar no WhatsApp** abre a
   conversa já no contato certo, com a mensagem montada — um clique por cobrança.
4. **Galpão** — cada pacote retornado vira tarefa com responsável, prazo e registros.
5. **Resolvidos** — o arquivo dos casos encerrados, fora do caminho.
6. **Copiar códigos para reconsultar** — devolve a lista de pedidos ainda em aberto,
   pronta para colar na consulta do JMS no dia seguinte.

## Encerrar um caso

Marcar a tratativa como **resolvida** tira o pacote do Painel de Ação, da fila do galpão
e da cobrança de uma vez — ele vai para a aba **Resolvidos**, de onde volta com um clique
em "Aberta".

A resolução vale **enquanto o pacote não se mexer**. Se chegar um bipe posterior ao
encerramento, o caso reabre sozinho e reaparece nas pendências marcado como
**"Voltou a se mover"** — dar baixa e o pacote continuar circulando é exatamente como uma
tratativa desaparece do radar.

Opcionalmente, envie também a planilha **Gestão de Bases**
(`Exportar carta de porte de entrega*.xlsx`): ela traz destinatário, endereço, bairro e
valor, que o relatório de escaneamento não tem — e sem os quais não dá para tratar
"cliente ausente" nem "endereço incorreto".

Com ela importada, a cobrança deixa de ser uma lista de códigos: cada pacote sai
identificado por cliente e endereço, e o motorista não precisa perguntar de qual pedido
se trata.

```
🔴 000000000000000 — NOME DO DESTINATÁRIO
   ENDEREÇO, BAIRRO
   com você há 14h 30min (fora do prazo) · ticket TT-00000
```

<sub>Exemplo com dados fictícios. Nenhum dado real da operação é versionado — ver `.gitignore`.</sub>

As duas planilhas precisam ser **do mesmo período** — elas cruzam por
`Número de pedido JMS`, e exports de semanas diferentes não têm pedidos em comum.

## Arquitetura

```
index.html · styles.css · app.js        interface (vanilla, sem build)
src/
  config.js      dicionário da operação: colunas do JMS, tipos de bipagem, SLAs
  ingest.js      parse → normalização → dedupe → merge idempotente
  domain.js      máquina de estados, despachos e motor de classificação
  tratativa.js   regras da tratativa e do envelhecimento da fila
  charge.js      mensagens de cobrança
  enrich.js      cruzamento com a Gestão de Bases
  export.js      códigos para reconsultar e relatório CSV
  repo.js        ÚNICA camada de persistência (IndexedDB hoje, API amanhã)
  ui/            telas
vendor/          SheetJS
tools/validate.js
```

Três decisões que sustentam o resto:

- **Os eventos são guardados crus.** A deduplicação acontece na leitura, então a regra
  pode melhorar sem exigir reimportar nada.
- **A identidade do evento é o próprio conteúdo** (`pedido|data|tipo|base|digitalizador`).
  É isso que torna a importação idempotente.
- **`repo.js` é a única porta de dados.** Trocar IndexedDB por uma API não toca na UI.

## Detalhes do JMS que custam caro se ignorados

- `Digitalizador` **≠** `Correio de coleta ou entrega`. O primeiro é quem bipou (conferente
  ou até um equipamento), o segundo é quem está com o pacote. A cobrança usa **sempre** o
  segundo.
- `Chegadas ao centro` + `Digitalização de descarga` (e `bipe de expedição` +
  `Digitalização de carregamento`) são o mesmo fato gravado duas vezes. Somando os bipes
  duplicados de equipamento e os cliques duplos, **214 linhas viram 125 eventos reais**.
- Ordenar por `Tempo de digitalização`, nunca por `Tempo de upload` — há bipes offline que
  chegam com até 62 minutos de atraso.
- `Tipo problemático` vem bilíngue e com pontos no lugar dos espaços
  (`Ausência.do.destinatário客户不在`) e precisa ser limpo.
- Nomes de motorista vêm com prefixo de filial (`F RVD - `).

## SLAs (em `src/config.js`)

| Parâmetro | Valor | Significado |
|---|---|---|
| `posseMotoristaHoras` | 8h | despacho aberto além disso = atrasado |
| `registroOcorrenciaHoras` | 4h | demora para registrar a problemática |
| `expedicaoDaBaseHoras` | 12h | recebido na base e não despachado |
| `semMovimentoHoras` | 24h | nenhum bipe de nenhum tipo |
