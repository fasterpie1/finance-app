// Safari em modo privado e cota cheia lançam exceção; isso não pode derrubar a UI.
export function safeSetItem(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* ignora: preferência não persiste, app segue vivo */ }
}

export function safeRemoveItem(key: string): void {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}
