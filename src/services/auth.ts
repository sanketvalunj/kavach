export type UserRole = 'OPERATOR' | 'RESEARCHER';
export interface AuthSession { accessToken: string; username: string; role: UserRole }
const storageKey = 'kavach-auth-session-v1';
export function getAuthSession(): AuthSession | null {
  try { const raw = sessionStorage.getItem(storageKey); return raw ? JSON.parse(raw) as AuthSession : null; } catch { return null; }
}
export function saveAuthSession(session: AuthSession): void { sessionStorage.setItem(storageKey, JSON.stringify(session)); }
export function clearAuthSession(): void { sessionStorage.removeItem(storageKey); }
export function getAccessToken(): string | null { return getAuthSession()?.accessToken ?? null; }
