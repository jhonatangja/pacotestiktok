// ---------------------------------------------------------------------------
// supabase-config.js — a chave que liga o modo tempo real.
//
// VAZIO (padrão): o sistema roda 100% local, no navegador (IndexedDB). Nada
// muda em relação a como funcionava antes — nenhum dado sai da máquina.
//
// PREENCHIDO: o sistema passa a usar o Supabase — base compartilhada em tempo
// real entre os operadores, atrás de login. Preencha os dois campos abaixo com
// o que o painel do Supabase mostra em Settings → API. São seguros de ficar
// no código: o acesso é protegido por login + regras de linha (RLS).
//
// Passo a passo completo de configuração: ver SETUP-SUPABASE.md.
// ---------------------------------------------------------------------------

export const SUPABASE = {
  url: "",       // ex.: https://abcdxyz.supabase.co
  anonKey: "",   // a chave "anon public" (começa com eyJ...)
};

/** Com os dois campos preenchidos, o app entra no modo nuvem. */
export function usarSupabase() {
  return Boolean(SUPABASE.url && SUPABASE.anonKey);
}
