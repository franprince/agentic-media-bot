import type { QBittorrentTorrent } from "../types/qbittorrent";
import { executeOnProxy, isProxyEnabled } from "../agent/proxyClient";

function getConfig() {
    const url = process.env.QBITTORRENT_URL?.trim();
    const username = process.env.QBITTORRENT_USERNAME?.trim();
    const password = process.env.QBITTORRENT_PASSWORD?.trim();

    if (!url || !username || !password) {
        throw new Error("Missing qBittorrent credentials in environment variables.");
    }
    return { url, username, password };
}

// Global variable to store the authentication cookie
let _authCookie: string | null = null;

async function authenticate(): Promise<void> {
    const { url, username, password } = getConfig();

    const formData = new URLSearchParams();
    formData.append("username", username);
    formData.append("password", password);

    const response = await fetch(`${url}/api/v2/auth/login`, {
        method: "POST",
        body: formData,
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to authenticate with qBittorrent: ${response.statusText}`);
    }

    const setCookieHeader = response.headers.get("set-cookie");
    if (!setCookieHeader) {
        throw new Error("qBittorrent authentication failed: No cookie received.");
    }

    // Extract the SID cookie (handling both legacy SID and modern QBT_SID_<port>)
    const sidMatch = setCookieHeader.match(/((?:QBT_)?SID(?:_\d+)?)=([^;]+)/i);
    if (!sidMatch) {
        throw new Error("qBittorrent authentication failed: SID cookie not found.");
    }

    _authCookie = `${sidMatch[1]}=${sidMatch[2]}`;
}

async function fetchQbittorrent<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
    if (!_authCookie) {
        await authenticate();
    }

    const { url: baseUrl } = getConfig();

    const executeRequest = async () => {
        const url = new URL(`/api/v2${endpoint}`, baseUrl);
        const headers = new Headers(options.headers);
        if (_authCookie) {
            headers.set("Cookie", _authCookie);
        }

        return fetch(url.toString(), {
            ...options,
            headers,
        });
    };

    let response = await executeRequest();

    // If unauthorized, the cookie might have expired. Re-authenticate and try once more.
    if (response.status === 403) {
        await authenticate();
        response = await executeRequest();
    }

    if (!response.ok) {
        throw new Error(`qBittorrent API Error on ${endpoint}: ${response.status}`);
    }

    // Some qBittorrent endpoints just return an empty success response without JSON
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
        return response.json() as Promise<T>;
    }

    // Return the response object for non-JSON returns (like pause/resume actions)
    return response as any;
}

export async function getTorrents(filter: string = "all"): Promise<QBittorrentTorrent[]> {
    if (isProxyEnabled()) return executeOnProxy("qbittorrent", "getTorrents", [filter]);
    return fetchQbittorrent<QBittorrentTorrent[]>(`/torrents/info?filter=${filter}`);
}

export async function pauseTorrent(hash: string): Promise<void> {
    if (isProxyEnabled()) return executeOnProxy("qbittorrent", "pauseTorrent", [hash]);
    await fetchQbittorrent("/torrents/pause", {
        method: "POST",
        body: new URLSearchParams({ hashes: hash }),
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
    });
}

export async function resumeTorrent(hash: string): Promise<void> {
    if (isProxyEnabled()) return executeOnProxy("qbittorrent", "resumeTorrent", [hash]);
    await fetchQbittorrent("/torrents/resume", {
        method: "POST",
        body: new URLSearchParams({ hashes: hash }),
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
    });
}
