// ---------------------------------------------------------------------------
// repo-supabase.js — a implementação em nuvem do repositório.
//
// Mesma interface de `createIndexedDbRepo` (ver repo.js): a UI não sabe se está
// falando com o navegador ou com o Postgres. A diferença é que aqui a base é
// COMPARTILHADA e em TEMPO REAL — o método `subscribe` avisa quando outro
// operador mexe em algo, para a tela recarregar sozinha.
//
// Cada store vira uma tabela com o objeto guardado como jsonb no campo
// `payload`. Isso espelha exatamente o formato chave→objeto que o resto do
// sistema já usa, sem precisar mapear coluna a coluna.
//
// O cliente supabase-js é carregado sob demanda de um CDN (só quando o modo
// nuvem está ligado), para o caminho local não depender de rede.
// ---------------------------------------------------------------------------

import { SUPABASE } from "./supabase-config.js";

const CDN = "https://esm.sh/@supabase/supabase-js@2";

let clientPromise = null;

/** Cria (uma vez) o cliente supabase-js, importando a lib do CDN. */
export async function getSupabaseClient() {
  if (!clientPromise) {
    clientPromise = import(/* @vite-ignore */ CDN).then(({ createClient }) =>
      createClient(SUPABASE.url, SUPABASE.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true },
      })
    );
  }
  return clientPromise;
}

// tabela → coluna que é a chave primária
const PK = {
  events: "id",
  treatments: "pkg_id",
  enrichment: "pkg_id",
  contacts: "driver",
  activities: "id",
  meta: "key",
};

export function createSupabaseRepo(client) {
  const sb = client;

  // extrai o objeto guardado, seja qual for a tabela
  const payloads = (rows) => (rows ?? []).map((r) => r.payload ?? r.value);

  async function selectAll(tabela) {
    const { data, error } = await sb.from(tabela).select("*");
    if (error) throw new Error(`Falha ao ler ${tabela}: ${error.message}`);
    return payloads(data);
  }

  async function upsert(tabela, linhas) {
    if (!linhas.length) return;
    const { error } = await sb.from(tabela).upsert(linhas, { onConflict: PK[tabela] });
    if (error) throw new Error(`Falha ao gravar ${tabela}: ${error.message}`);
  }

  return {
    // -- eventos (append-only, id = conteúdo → idempotente) ------------------
    getEvents: () => selectAll("events"),

    async getEventsByPkg(pkgId) {
      const { data, error } = await sb.from("events").select("*").eq("pkg_id", pkgId);
      if (error) throw new Error(`Falha ao ler eventos: ${error.message}`);
      return payloads(data);
    },

    async putEvents(events) {
      // ignoreDuplicates: reimportar não sobrescreve nem duplica (id é a chave)
      const linhas = events.map((e) => ({ id: e.id, pkg_id: e.pkgId, ts: e.ts, payload: e }));
      if (linhas.length) {
        const { error } = await sb.from("events")
          .upsert(linhas, { onConflict: "id", ignoreDuplicates: true });
        if (error) throw new Error(`Falha ao gravar eventos: ${error.message}`);
      }
      return events.length;
    },

    async clearEvents() {
      const { error } = await sb.from("events").delete().neq("id", "");
      if (error) throw new Error(`Falha ao limpar eventos: ${error.message}`);
    },

    // -- tratativas ---------------------------------------------------------
    getTreatments: () => selectAll("treatments"),

    async getTreatment(pkgId) {
      const { data, error } = await sb.from("treatments").select("*").eq("pkg_id", pkgId).maybeSingle();
      if (error) throw new Error(`Falha ao ler tratativa: ${error.message}`);
      return data ? data.payload : null;
    },

    async putTreatment(t) {
      const payload = { ...t, atualizadaEm: new Date().toISOString() };
      await upsert("treatments", [{ pkg_id: t.pkgId, payload }]);
      return t.pkgId;
    },

    async deleteTreatment(pkgId) {
      const { error } = await sb.from("treatments").delete().eq("pkg_id", pkgId);
      if (error) throw new Error(`Falha ao apagar tratativa: ${error.message}`);
    },

    // -- enriquecimento -----------------------------------------------------
    getEnrichment: () => selectAll("enrichment"),
    putEnrichment: (itens) =>
      upsert("enrichment", itens.map((e) => ({ pkg_id: e.pkgId, payload: e }))),

    // -- contatos -----------------------------------------------------------
    getContacts: () => selectAll("contacts"),

    async putContact(c) {
      const payload = { ...c, atualizadaEm: new Date().toISOString() };
      await upsert("contacts", [{ driver: c.driver, payload }]);
      return c.driver;
    },

    async deleteContact(driver) {
      const { error } = await sb.from("contacts").delete().eq("driver", driver);
      if (error) throw new Error(`Falha ao apagar contato: ${error.message}`);
    },

    // -- atividades ---------------------------------------------------------
    getActivities: () => selectAll("activities"),

    /**
     * Insert puro, não upsert: o log é append-only e cada operador escreve a
     * sua própria linha. Dois registrando ao mesmo tempo não se sobrescrevem.
     */
    async putActivity(a) {
      const { error } = await sb.from("activities")
        .upsert({ id: a.id, pkg_id: a.pkgId, em: a.em, payload: a }, { onConflict: "id", ignoreDuplicates: true });
      if (error) throw new Error(`Falha ao registrar atividade: ${error.message}`);
      return a.id;
    },

    // -- meta (config, log de importações, cobranças) -----------------------
    async getMeta(key, fallback = null) {
      const { data, error } = await sb.from("meta").select("value").eq("key", key).maybeSingle();
      if (error) throw new Error(`Falha ao ler meta: ${error.message}`);
      return data ? data.value : fallback;
    },

    async setMeta(key, value) {
      const { error } = await sb.from("meta").upsert({ key, value }, { onConflict: "key" });
      if (error) throw new Error(`Falha ao gravar meta: ${error.message}`);
    },

    async registrarImportacao(info) {
      const log = (await this.getMeta("importacoes", [])) ?? [];
      log.unshift({ ...info, em: new Date().toISOString() });
      await this.setMeta("importacoes", log.slice(0, 50));
    },

    // -- tempo real ---------------------------------------------------------
    /**
     * Avisa quando qualquer operador altera qualquer tabela. Devolve uma função
     * para cancelar a inscrição. O app usa isso para recarregar a tela sozinho.
     */
    subscribe(onChange) {
      const canal = sb.channel("operacao");
      for (const tabela of Object.keys(PK)) {
        canal.on("postgres_changes", { event: "*", schema: "public", table: tabela },
          (msg) => onChange(tabela, msg));
      }
      canal.subscribe();
      return () => sb.removeChannel(canal);
    },
  };
}
