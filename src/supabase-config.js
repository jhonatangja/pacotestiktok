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
  url: "https://fedsgmppmyodyxykvqcz.supabase.co",
  // Chave "publishable" — o equivalente novo da anon. É segura no navegador
  // porque todas as tabelas têm Row Level Security e as políticas exigem login.
  anonKey: "sb_publishable_KxN5JUGWKCsuRpBsfUa1kw_UrK-YdH6",

  // O Supabase exige e-mail no login, mas o operador só digita um usuário
  // simples (ex.: "base"). O sistema completa com este domínio interno por
  // baixo dos panos — ninguém precisa de e-mail de verdade nem confirmar nada.
  dominioLogin: "pacotes.local",
};

/** Com os dois campos preenchidos, o app entra no modo nuvem. */
export function usarSupabase() {
  return Boolean(SUPABASE.url && SUPABASE.anonKey);
}

/**
 * "base" → "base@pacotes.local". Se o operador já digitar um e-mail completo,
 * respeita. É o que permite o login por usuário + senha, sem e-mail real.
 */
export function usuarioParaEmail(usuario) {
  const u = String(usuario ?? "").trim().toLowerCase();
  if (!u) return "";
  return u.includes("@") ? u : `${u}@${SUPABASE.dominioLogin}`;
}

/** Caminho inverso, só para exibir o usuário sem o domínio interno. */
export function emailParaUsuario(email) {
  const e = String(email ?? "");
  return e.endsWith(`@${SUPABASE.dominioLogin}`) ? e.slice(0, -(`@${SUPABASE.dominioLogin}`).length) : e;
}
