// ---------------------------------------------------------------------------
// repo.js — ÚNICA camada de persistência do sistema.
//
// Nenhuma tela e nenhuma regra de negócio fala com IndexedDB diretamente: tudo
// passa por esta interface. Quando a operação virar multiusuário, basta uma
// implementação nova com os mesmos métodos (`createApiRepo`) — a UI não muda.
//
// Por que IndexedDB e não localStorage: aqui o histórico ACUMULA entre dias
// (cada importação soma eventos). localStorage estoura a cota rapidamente.
//
// Regra inviolável: `treatments` é dado do usuário. Importação nunca escreve
// nem apaga nada nesse store.
// ---------------------------------------------------------------------------

const DB_NAME = "gestao_pacotes_tiktok";
const DB_VERSION = 2;

const STORE = {
  events: "events",           // eventos do JMS — append-only, chave = conteúdo
  treatments: "treatments",   // tratativas do galpão — dado do usuário
  enrichment: "enrichment",   // dados da Gestão de Bases (destinatário/endereço)
  contacts: "contacts",       // telefone do motorista — cadastrado uma vez, chave = nome
  meta: "meta",               // configurações e log de importações
};

function abrirDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE.events)) {
        const s = db.createObjectStore(STORE.events, { keyPath: "id" });
        s.createIndex("pkgId", "pkgId", { unique: false });
        s.createIndex("ts", "ts", { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE.treatments)) {
        db.createObjectStore(STORE.treatments, { keyPath: "pkgId" });
      }
      if (!db.objectStoreNames.contains(STORE.enrichment)) {
        db.createObjectStore(STORE.enrichment, { keyPath: "pkgId" });
      }
      if (!db.objectStoreNames.contains(STORE.contacts)) {
        db.createObjectStore(STORE.contacts, { keyPath: "driver" });
      }
      if (!db.objectStoreNames.contains(STORE.meta)) {
        db.createObjectStore(STORE.meta, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const doneOf = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});

const askOf = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

export function createIndexedDbRepo() {
  let dbPromise = null;
  const db = () => (dbPromise ??= abrirDb());

  async function readAll(store) {
    const tx = (await db()).transaction(store, "readonly");
    return askOf(tx.objectStore(store).getAll());
  }

  async function writeAll(store, itens) {
    if (!itens.length) return;
    const tx = (await db()).transaction(store, "readwrite");
    const os = tx.objectStore(store);
    for (const it of itens) os.put(it);
    await doneOf(tx);
  }

  return {
    // -- eventos ------------------------------------------------------------
    getEvents: () => readAll(STORE.events),

    async getEventsByPkg(pkgId) {
      const tx = (await db()).transaction(STORE.events, "readonly");
      return askOf(tx.objectStore(STORE.events).index("pkgId").getAll(pkgId));
    },

    /** Idempotente: a chave é o conteúdo do evento, reimportar não duplica. */
    async putEvents(events) {
      await writeAll(STORE.events, events);
      return events.length;
    },

    async clearEvents() {
      const tx = (await db()).transaction(STORE.events, "readwrite");
      tx.objectStore(STORE.events).clear();
      await doneOf(tx);
    },

    // -- tratativas (dado do usuário — a importação nunca toca aqui) ---------
    getTreatments: () => readAll(STORE.treatments),

    async getTreatment(pkgId) {
      const tx = (await db()).transaction(STORE.treatments, "readonly");
      return (await askOf(tx.objectStore(STORE.treatments).get(pkgId))) ?? null;
    },

    async putTreatment(t) {
      await writeAll(STORE.treatments, [{ ...t, atualizadaEm: new Date().toISOString() }]);
      return t.pkgId;
    },

    async deleteTreatment(pkgId) {
      const tx = (await db()).transaction(STORE.treatments, "readwrite");
      tx.objectStore(STORE.treatments).delete(pkgId);
      await doneOf(tx);
    },

    // -- enriquecimento (Gestão de Bases) -----------------------------------
    getEnrichment: () => readAll(STORE.enrichment),
    putEnrichment: (itens) => writeAll(STORE.enrichment, itens),

    // -- contatos (telefone do motorista — dado do usuário) -----------------
    getContacts: () => readAll(STORE.contacts),

    async putContact(c) {
      await writeAll(STORE.contacts, [{ ...c, atualizadaEm: new Date().toISOString() }]);
      return c.driver;
    },

    async deleteContact(driver) {
      const tx = (await db()).transaction(STORE.contacts, "readwrite");
      tx.objectStore(STORE.contacts).delete(driver);
      await doneOf(tx);
    },

    // -- meta ---------------------------------------------------------------
    async getMeta(key, fallback = null) {
      const tx = (await db()).transaction(STORE.meta, "readonly");
      const row = await askOf(tx.objectStore(STORE.meta).get(key));
      return row ? row.value : fallback;
    },

    async setMeta(key, value) {
      await writeAll(STORE.meta, [{ key, value }]);
    },

    /** Histórico de importações — útil para auditar de onde veio cada evento. */
    async registrarImportacao(info) {
      const log = (await this.getMeta("importacoes", [])) ?? [];
      log.unshift({ ...info, em: new Date().toISOString() });
      await this.setMeta("importacoes", log.slice(0, 50));
    },
  };
}

/**
 * Repositório em memória — usado pelo validador em Node e por testes.
 * Mesma interface, sem IndexedDB.
 */
export function createMemoryRepo(seed = {}) {
  const stores = {
    events: new Map((seed.events ?? []).map((e) => [e.id, e])),
    treatments: new Map((seed.treatments ?? []).map((t) => [t.pkgId, t])),
    enrichment: new Map((seed.enrichment ?? []).map((e) => [e.pkgId, e])),
    contacts: new Map((seed.contacts ?? []).map((c) => [c.driver, c])),
    meta: new Map(Object.entries(seed.meta ?? {})),
  };

  return {
    getEvents: async () => [...stores.events.values()],
    getEventsByPkg: async (pkgId) => [...stores.events.values()].filter((e) => e.pkgId === pkgId),
    putEvents: async (events) => { for (const e of events) stores.events.set(e.id, e); return events.length; },
    clearEvents: async () => stores.events.clear(),

    getTreatments: async () => [...stores.treatments.values()],
    getTreatment: async (pkgId) => stores.treatments.get(pkgId) ?? null,
    putTreatment: async (t) => {
      stores.treatments.set(t.pkgId, { ...t, atualizadaEm: new Date().toISOString() });
      return t.pkgId;
    },
    deleteTreatment: async (pkgId) => { stores.treatments.delete(pkgId); },

    getEnrichment: async () => [...stores.enrichment.values()],
    putEnrichment: async (itens) => { for (const e of itens) stores.enrichment.set(e.pkgId, e); },

    getContacts: async () => [...stores.contacts.values()],
    putContact: async (c) => {
      stores.contacts.set(c.driver, { ...c, atualizadaEm: new Date().toISOString() });
      return c.driver;
    },
    deleteContact: async (driver) => { stores.contacts.delete(driver); },

    getMeta: async (key, fallback = null) => (stores.meta.has(key) ? stores.meta.get(key) : fallback),
    setMeta: async (key, value) => { stores.meta.set(key, value); },
    registrarImportacao: async (info) => {
      const log = stores.meta.get("importacoes") ?? [];
      log.unshift({ ...info, em: new Date().toISOString() });
      stores.meta.set("importacoes", log.slice(0, 50));
    },
  };
}

/** Escolhe a implementação disponível no ambiente. */
export function createRepo() {
  return typeof indexedDB !== "undefined" ? createIndexedDbRepo() : createMemoryRepo();
}
