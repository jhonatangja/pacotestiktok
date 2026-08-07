// ---------------------------------------------------------------------------
// contatos.js — telefone do motorista e link de cobrança direta no WhatsApp.
//
// A ideia: cadastrar o número uma vez e, a cada pacote pendente, disparar a
// cobrança com um clique — o WhatsApp abre já no contato certo e com a
// mensagem pronta, o operador só aperta enviar.
//
// Foco em números brasileiros (o único caso da operação). Puro e testável em
// Node — não depende de navegador nem de armazenamento.
// ---------------------------------------------------------------------------

/**
 * Reduz o que o operador digitou a dígitos com código do país, no formato que
 * o wa.me espera (ex.: "(64) 99999-8888" → "5564999998888").
 * Aceita com ou sem 55, com ou sem parênteses, traços e espaços.
 * Devolve null se estiver vazio; devolve o que veio se fugir do padrão BR,
 * para o operador ver que precisa corrigir.
 */
export function normalizarTelefone(raw) {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) return d;
  if (d.length === 10 || d.length === 11) return "55" + d;   // DDD + número, sem país
  return d;
}

/** Um número BR válido tem 12 (fixo) ou 13 (celular) dígitos com o 55. */
export function telefoneValido(raw) {
  const d = normalizarTelefone(raw);
  return !!d && d.startsWith("55") && (d.length === 12 || d.length === 13);
}

/** "5564999998888" → "(64) 99999-8888", para exibir. */
export function formatarTelefone(raw) {
  const d = normalizarTelefone(raw);
  if (!d || !d.startsWith("55") || d.length < 12) return String(raw ?? "");
  const nac = d.slice(2);
  const ddd = nac.slice(0, 2);
  const num = nac.slice(2);
  if (num.length === 9) return `(${ddd}) ${num.slice(0, 5)}-${num.slice(5)}`;
  if (num.length === 8) return `(${ddd}) ${num.slice(0, 4)}-${num.slice(4)}`;
  return `(${ddd}) ${num}`;
}

/**
 * Monta o link do WhatsApp com a mensagem embutida. Abrir esse link leva
 * direto à conversa com o motorista, texto já digitado.
 */
export function linkWhatsApp(raw, mensagem = "") {
  const d = normalizarTelefone(raw);
  if (!d) return null;
  const base = `https://wa.me/${d}`;
  return mensagem ? `${base}?text=${encodeURIComponent(mensagem)}` : base;
}
