// ---------------------------------------------------------------------------
// versao.js — o carimbo da versão publicada e a auto-atualização.
//
// O PROBLEMA QUE ISTO RESOLVE
//
// O GitHub Pages serve os arquivos com `Cache-Control: max-age=600`. Depois de
// uma publicação, o navegador de quem já usou o sistema continua rodando o
// JavaScript velho por até 10 minutos — sem avisar ninguém. O operador vê a
// tela antiga, conclui que a mudança não funcionou, e não tem como saber que o
// problema é o cache dele.
//
// Não dá para versionar as URLs dos módulos: o projeto não tem build, e os
// imports são caminhos relativos que o navegador resolve sem query.
//
// A SAÍDA
//
// `fetch(url, { cache: "reload" })` ignora o cache E grava a resposta nova por
// cima da entrada antiga. Então: se a versão publicada é outra, rebuscamos cada
// arquivo assim e recarregamos a página — aí sim o reload encontra código novo.
//
// A versão é lida do próprio arquivo publicado — a constante logo abaixo —,
// então não existe um segundo lugar para esquecer de atualizar: basta subir o
// número daqui a cada publicação.
// ---------------------------------------------------------------------------

export const VERSAO = "2026-08-14.2";

// Ancorada no início da linha: um exemplo dentro de um comentário não pode ser
// confundido com a constante, ou o app se acharia velho para sempre.
const RE_VERSAO = /^export const VERSAO\s*=\s*"([^"]+)"/m;

/**
 * Tudo que o navegador guarda em cache e precisa ser renovado junto.
 * `tools/validate.js` confere que nenhum módulo de `src/` ficou de fora.
 */
export const ARQUIVOS = [
  "index.html", "app.js", "styles.css",
  "src/versao.js",
  "src/acao.js", "src/aguardando.js", "src/atividades.js", "src/charge.js", "src/config.js",
  "src/contatos.js", "src/domain.js", "src/enrich.js", "src/export.js",
  "src/ingest.js", "src/repo-supabase.js", "src/repo.js", "src/supabase-config.js",
  "src/tratativa.js",
  "src/ui/cards.js", "src/ui/cliente.js", "src/ui/cobranca.js", "src/ui/fechamento.js", "src/ui/format.js",
  "src/ui/galpao.js", "src/ui/motoristas.js", "src/ui/pacote.js", "src/ui/painel.js",
  "src/ui/resolvidos.js",
];

const MARCA_RELOAD = "pacotes:atualizando";

/** Lê a versão que está publicada no servidor agora, sem passar pelo cache. */
export async function versaoPublicada() {
  const url = new URL("./versao.js", import.meta.url);
  const texto = await (await fetch(url, { cache: "no-store" })).text();
  return texto.match(RE_VERSAO)?.[1] ?? null;
}

/**
 * Compara a versão em execução com a publicada e, se estiver velha, renova o
 * cache e recarrega.
 *
 * @returns {Promise<boolean>} true se vai recarregar (quem chamou deve parar)
 */
export async function atualizarSeVelho(aviso = () => {}) {
  // Se acabamos de recarregar por causa disto e a versão AINDA não bate, parar.
  // Sem essa trava, uma publicação pela metade viraria um laço de reloads.
  if (sessionStorage.getItem(MARCA_RELOAD)) {
    sessionStorage.removeItem(MARCA_RELOAD);
    return false;
  }

  let publicada = null;
  try {
    publicada = await versaoPublicada();
  } catch {
    return false;   // offline ou servidor fora: seguir com o que está carregado
  }

  if (!publicada || publicada === VERSAO) return false;

  aviso(`Atualizando o sistema para a versão ${publicada}…`);
  const base = new URL("../", import.meta.url);
  await Promise.all(ARQUIVOS.map((f) =>
    fetch(new URL(f, base), { cache: "reload" }).catch(() => {})));

  sessionStorage.setItem(MARCA_RELOAD, "1");
  location.reload();
  return true;
}
