/**
 * Authenticated fetch wrapper for all proxy API calls.
 *
 * Automatically attaches the Authorization: Bearer header when VITE_DASHBOARD_TOKEN
 * is set in the environment (via .env or the build process). This allows the proxy
 * dashboard to work correctly when DASHBOARD_TOKEN auth is enabled on the server.
 *
 * Falls back to unauthenticated requests when the token is not configured,
 * preserving backward-compatibility with deployments that don't use auth.
 */

const DASHBOARD_TOKEN = import.meta.env.VITE_DASHBOARD_TOKEN as string | undefined;

type FetchOptions = RequestInit & { headers?: Record<string, string> };

export function apiFetch(url: string, options: FetchOptions = {}): Promise<Response> {
    const headers: Record<string, string> = { ...options.headers };

    if (DASHBOARD_TOKEN) {
        headers['Authorization'] = `Bearer ${DASHBOARD_TOKEN}`;
    }

    return fetch(url, { ...options, headers });
}
