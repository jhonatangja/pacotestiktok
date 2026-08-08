# Controle de Pacotes · TikTok Shop

Sistema interno da base **F RVD - GO** (Rio Verde/GO) para transformar o log bruto de
escaneamento do JMS em fila de ação: quem cobrar agora, o que tratar no galpão e o que
não pode ser esquecido.

## A regra que o sistema existe para vigiar

Um pacote sob posse de motorista só tem **três saídas legítimas**:

1. registrar a problemática;
2. finalizar a entrega — hoje com evidência formal: o bipe `assinatura de encomenda`;
3. devolver ao galpão.

Qualquer outro desfecho é pendência. O caso mais grave — e invisível no JMS — é o
**rebipe sem tratativa**: o pacote recebe um novo `bipe de saída para entrega` sem que
nenhuma das três saídas tenha acontecido antes. Ele roda dia após dia parecendo normal
enquanto o motorista o carrega sem prestar contas.

Na amostra de 06/08/2026 isso atingia **3 de 9 pacotes** (até 72h de posse silenciosa).

TikTok Shop é entrega no mesmo dia, então **todo pacote que está com motorista é
pendência viva** — mesmo o que saiu há uma hora. O prazo de 8h muda a cor do cartão,
não a necessidade de cobrar.

## Duas bases em Rio Verde

A operação tem **F RVD - GO** (RVD 1) e **F RVD 02-GO** (RVD 2). Um pacote que passa de uma
para a outra **não sai do circuito** — só muda de quem é a responsabilidade. Quem responde é
sempre a **última das nossas bases que deu `bipe de recebimento`** nele.

Só um recebimento numa base de **fora** dessa lista encerra o caso aqui. A lista está em
`BASES_OPERACAO` (`src/config.js`).

Para não misturar as duas:

- cada cartão leva o carimbo da base — **RVD 1** discreto, **RVD 2** destacado, porque o que
  precisa saltar aos olhos é a exceção, não a regra;
- pacote que trocou de base ganha **⇄** no carimbo;
- o Painel de Ação tem uma barra **Responsabilidade** no topo que filtra por base, e os
  indicadores acompanham o filtro — senão o número diria uma coisa e a lista mostraria outra;
- o relatório CSV tem a coluna **Base responsável**.

## O relógio da base

A idade de um pacote conta a partir do `bipe de recebimento` — quando ele chega em
F RVD - GO. O tempo de trânsito nacional que veio antes não é responsabilidade daqui,
e por isso não entra nem no cartão nem no cálculo de prioridade: um pacote que demorou
4 dias para chegar mas chegou hoje não é mais urgente que outro parado aqui há 3 dias.

A data de coleta continua visível no detalhe do pacote, como contexto.

Cada cartão mostra **desde quando** o pacote está no circuito (`No circuito desde 31/07 · há
8d`). O tempo decorrido responde a urgência; a data é o que se usa para conferir com a
planilha e para dizer ao cliente desde quando o pacote está parado aqui.

## Quanto tempo a operação leva para resolver

A aba **Resolvidos** mede o ciclo fechado: do `bipe de recebimento` até o desfecho. Filtro
por janela (**7 dias / 30 dias / Tudo**) e cinco números:

| Indicador | Por que está lá |
|---|---|
| **tempo médio** | o número que se leva para a reunião |
| **tempo típico (mediana)** | um pacote esquecido por 15 dias puxa a média inteira; a mediana mostra o caso comum, e a distância entre as duas é o tamanho da cauda |
| **o mais demorado** | o pior caso do período, que é onde está o problema |
| **resolvidos em até 24h** | TikTok é entrega no mesmo dia — este é o número que deveria ser o total |
| **casos encerrados** | o tamanho da amostra, para não tirar conclusão de 2 pacotes |

Cada cartão traz **Resolvido em Xd Yh** e a data de entrada. Casos sem `bipe de recebimento`
registrado ficam fora da média (e a tela diz quantos são) — medir o que não tem marco zero
seria inventar número.

## A cobrança do motorista

**A fila lista só quem está com pacote na mão agora.** Um despacho encerrado não é dívida
de ninguém: se o pacote saiu de novo com outra pessoa, voltou ao galpão ou foi entregue, a
responsabilidade mudou de mãos, e continuar listando quem já passou o pacote adiante faz a
operação cobrar a pessoa errada.

O histórico não some — muda de lugar. Rebipe e ocorrência tardia continuam pesando na
conta, mas **só do pacote que a pessoa ainda segura**: é o que dá para cobrar hoje, na
mesma conversa. O desempenho passado de quem não tem nada em aberto é assunto da aba
Motoristas, não de uma fila cujo título é "cobrar agora".

**Todo pacote no circuito é cobrado como cliente aguardando.** TikTok Shop é entrega no
mesmo dia: se o pacote ainda não teve desfecho, alguém está esperando por ele agora — com
ou sem chamado aberto na plataforma. A mensagem deixou de ter duas listas (uma "urgente" e
outra "sem baixa"), porque a segunda lista ensinava o motorista a tratá-la como opcional.

**O prazo exigido muda sozinho às 14h** (`CORTE_ENTREGA_HOJE` em `src/config.js`):

| Horário da cobrança | O que a mensagem exige |
|---|---|
| Antes das 14h | entrega **hoje**; se não der, a problemática registrada **com a evidência da tentativa de contato** |
| A partir das 14h | **tentar hoje ainda** e, não dando pelo horário, entregar **amanhã logo pela manhã, na primeira rota**; a problemática registrada ainda hoje, com a evidência |

Depois das 14h a ordem continua sendo **tentar hoje** — o horário não desobriga ninguém. A
manhã seguinte entra como alternativa para o que de fato não couber mais no dia, não como
dispensa do dia.

O que **não** muda com o horário é a evidência: sem o print da ligação ou da conversa, a
problemática registrada no sistema não sustenta nada quando o cliente reclamar. A tela de
cobrança avisa qual dos dois prazos a mensagem vai levar **antes** de você clicar.

## Ticket do cliente

Quando o cliente abre reclamação na TikTok Shop, marque o ticket no pacote. É o único
sinal do sistema que não vem de planilha nenhuma — vem da plataforma, e é marcado à mão.

Como a cobrança já trata **todos** os pacotes do circuito como cliente aguardando, o ticket
marcado passou a significar uma coisa mais estreita e mais útil: **existe um chamado aberto,
com protocolo**. É esse recorte que ainda sobe o pacote para o topo do painel e ganha o
chip vermelho — uma marca que todo mundo tem não ordena nada.

Duas formas de lançar:

- **Em lote**, pelo campo no topo do Painel de Ação: cole a lista de códigos como ela
  vier (uma por linha, vírgula, tabulação ou espaço), Enter marca. O mesmo campo remove.
- **Um a um**, pelo botão no topo do detalhe do pacote — é aí que dá para guardar o
  número do protocolo.

Código que ainda não foi importado **não é descartado**: o ticket fica guardado e passa
a valer sozinho quando o pacote aparecer numa importação futura. A reclamação do cliente
quase sempre chega antes do bipe.

## Adicionar pacotes ao circuito antes do bipe

O campo no topo do Painel de Ação é também o lugar de **lançar um pacote novo**: cole o
código e ele entra no circuito na hora, sempre como **ticket do cliente** — é para isso
que se lança à mão.

Um código sem nenhum bipe no JMS não vira pacote de mentira. Ele aparece numa lista
própria, **Aguardando importação**, com um cartão deliberadamente vazio: não há histórico
para mostrar, só o código, há quanto tempo foi lançado e o número do protocolo. Preencher
esse cartão com dado inventado seria pior que mostrar o vazio.

O que ele ganha por estar ali:

- conta no indicador de **ticket do cliente** e no contador da aba;
- entra na lista **Copiar os códigos do circuito** e na de **reconsultar no JMS** — em
  primeiro lugar, porque consultar o JMS é exatamente o que falta para ele virar pacote;
- aparece no resumo do fechamento em seção própria: *sem nenhum bipe no JMS*, para quem
  estiver com ele se manifestar;
- some da lista sozinho na primeira importação em que o código aparecer, virando um pacote
  normal — já com o ticket marcado.

Se o código foi digitado errado, o botão **Remover** apaga o lançamento. Ele fica abaixo
das pendências reais de propósito: um cartão sem dado nenhum não pode empurrar para baixo
um pacote que está com motorista há 30 horas.

Um pacote com ticket:

- vira o **primeiro da fila**, num nível acima de tudo (não é peso somado — um pacote
  velho o suficiente acabaria passando na frente se fosse);
- aparece com 🔴 e em primeiro lugar **dentro do grupo da ação a que pertence**;
- leva o número do protocolo na mensagem de cobrança;
- puxa o motorista para o topo da fila de cobrança.

O ticket **não** cria um grupo próprio no Painel de Ação. Já criou, e atrapalhava: ele
arrancava pacotes de "Tratar no galpão" e de "Cobrar motorista" e os juntava numa lista só,
misturando quem está na base com quem está na rua — duas ações completamente diferentes. O
painel agrupa sempre pela **ação necessária**; o ticket é destaque dentro do grupo, e o
cabeçalho mostra quantos daquele grupo têm reclamação aberta.

Marcar a tratativa como **resolvida** encerra o ticket automaticamente.

## Dois modos

- **Local (padrão)** — roda 100% no navegador, os dados ficam só na máquina. Zero configuração.
- **Nuvem (tempo real)** — base compartilhada entre 2–5 operadores, atrás de login, com a tela
  atualizando sozinha quando alguém mexe em algo. Liga preenchendo `src/supabase-config.js` —
  passo a passo em **[SETUP-SUPABASE.md](SETUP-SUPABASE.md)**.

A troca não muda a interface: `src/repo.js` é a única camada de dados, e o modo nuvem
(`src/repo-supabase.js`) implementa a mesma interface. Se a nuvem cair, o sistema volta sozinho
para a base local da máquina.

## Publicação e versão

O GitHub Pages serve os arquivos com `Cache-Control: max-age=600`. Sem tratamento, quem já
usou o sistema continuaria rodando o JavaScript antigo por até 10 minutos depois de uma
publicação — vendo a tela velha e concluindo que a mudança não funcionou.

Como o projeto não tem build, não dá para versionar a URL dos módulos. A saída é
`fetch(url, { cache: "reload" })`, que ignora o cache **e grava a resposta por cima da
entrada antiga**: no boot o app compara a sua versão com a publicada, renova os arquivos e
recarrega uma vez (com trava de sessão, para uma publicação pela metade não virar laço).

A versão em execução aparece no canto superior direito — serve para conferir, ao telefone
com alguém, se as duas pessoas estão vendo a mesma coisa.

> **Ao publicar, suba o número em `src/versao.js`.** O validador confere que todo módulo de
> `src/` está na lista de arquivos renovados; um módulo esquecido lá continuaria velho.

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
3. **Cobrança** — por motorista, com mensagem de WhatsApp pronta citando as três saídas
   e o prazo do horário (ver abaixo). **Só aparece quem está com pacote na mão agora.**
   Cadastre o WhatsApp do motorista uma vez e o botão **📲 Cobrar no WhatsApp** abre a
   conversa já no contato certo, com a mensagem montada — um clique por cobrança.
4. **Galpão** — cada pacote retornado vira tarefa com responsável, prazo e registros.
5. **Motoristas** — o cadastro de motoristas: todos que já apareceram num pacote, mais quem
   você registrar à mão. Guarde o WhatsApp uma vez e cobre com um clique de qualquer tela.
6. **Fechamento** — a varredura do fim do dia: tudo que ainda está no circuito, com
   cobrança de um clique por motorista exigindo a atualização da situação no JMS.
7. **Resolvidos** — o arquivo dos casos encerrados, e o **tempo de resolução** da operação.
6. **Copiar códigos para reconsultar** — devolve a lista de pedidos ainda em aberto,
   pronta para colar na consulta do JMS no dia seguinte.

## Ações da equipe (quem fez o quê)

Toda ação de operador fica registrada no card do pacote, com **autor e horário**: cobrou,
marcou ticket, assumiu, definiu prazo, registrou tentativa, finalizou. O log é
**append-only** — nunca editado nem apagado, senão não serviria para prestar contas.

É separado do histórico do JMS de propósito: aquele é máquina bipando, este é gente
decidindo. No modo nuvem o autor é o usuário logado (`base`, `samuel`, `jessica`), e o
registro de dois operadores agindo no mesmo segundo não se sobrescreve.

## Encerrar um caso

Um pacote sai do circuito de três formas:

| Desfecho | Como acontece |
|---|---|
| ✅ **Entregue ao cliente** | **automático** — bipe `assinatura de encomenda` no JMS |
| 🏢 **Recebido em outra base** | **automático** — `bipe de recebimento` em base diferente da sua |
| ✅ **Entregue** / ↩️ **Devolvido** | o operador finaliza no sistema |

Os dois primeiros não dependem de ninguém aqui. A **assinatura de encomenda** é a evidência
mais forte que o sistema conhece: o cliente assinou, o pacote está encerrado — e essa baixa
ganha até de uma marcação manual em sentido contrário. Um pacote assinado sai na hora do
Painel, da Cobrança, do Galpão, do Fechamento e da lista de reconsulta, e não reabre.

Finalizar tira o pacote do Painel de Ação, da fila do galpão, da cobrança e do fechamento
de uma vez — ele vai para a aba **Resolvidos**, de onde volta com um clique em "Aberta".

A resolução vale **enquanto o pacote não se mexer**. Se chegar um bipe posterior ao
encerramento, o caso reabre sozinho e reaparece nas pendências marcado como
**"Voltou a se mover"** — dar baixa e o pacote continuar circulando é exatamente como uma
tratativa desaparece do radar.

## Retenção do histórico até finalizar

O histórico de eventos é **append-only**: nada é apagado. Cada pacote guarda a linha do
tempo completa desde a coleta, e ela só cresce a cada importação. Enquanto o pacote **não
for finalizado** (marcado como resolvido), ele:

- continua nas telas de pendência com a idade contando desde o recebimento na base;
- entra na lista **Copiar códigos para reconsultar**, para você seguir puxando as
  atualizações dele do JMS no dia seguinte.

Quando é finalizado, sai das pendências e da lista de reconsulta, mas **permanece guardado**
na aba Resolvidos com todo o histórico — nunca é descartado.

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
  repo.js        camada de persistência local (IndexedDB) — o padrão
  repo-supabase.js  mesma interface, mas em nuvem e tempo real (opcional)
  supabase-config.js  o interruptor local ↔ nuvem
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

- `assinatura de encomenda` é a **baixa da entrega** — o único bipe que encerra o pacote
  sozinho e em definitivo. Fecha o despacho aberto e tira o pacote de todas as filas.
- **Nem todo "motorista" é motorista.** Algumas contas existem para tratativa **dentro da
  base**: no JMS o bipe sai idêntico ao de um despacho real, mas o pacote não foi para a
  rua e quem responde por ele é o **assistente daquela base**.
  `CONTAS_DE_TRATATIVA` (`src/config.js`) traduz a conta para o assistente:

  | Conta no JMS | Responsável de verdade |
  |---|---|
  | `SAMARA KELLIS PEREIRA DOS SANTOS` | **SAMUEL RVD 1** |
  | `DIONATAN DOS SANTOS` | **MARCOS RVD 2** |

  A tradução acontece na origem, ao montar o despacho, então cartão, cobrança e cadastro já
  veem a pessoa certa. Esconder a conta não serviria: o cartão passaria a apontar o
  motorista do despacho *anterior* — a pessoa errada. O nome original fica registrado no
  detalhe do pacote, para o sistema poder ser conferido contra a planilha.
  Esses pacotes ganham a situação **Em tratativa na base** e a ação **Tratar na base**,
  separada de "Cobrar motorista" e de "Tratar no galpão".
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
| `expedicaoCidadeBaseHoras` | 6h | recebido e não despachado, **destino Rio Verde** — sai na rota do dia, então parar é esquecimento |
| `expedicaoInteriorHoras` | 48h | recebido e não despachado, **destino interior** — espera a viagem daquela cidade, parar é o normal |
| `semMovimentoHoras` | 24h | nenhum bipe de nenhum tipo |
