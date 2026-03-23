import { executeOnProxy, isProxyEnabled } from "../agent/proxyClient";

export async function getQueue(): Promise<any> {
    if (isProxyEnabled()) return executeOnProxy("nzbget", "getQueue");
    return callNZBGetRPC("listgroups", [0]); // 0 = all groups
}

export async function getStatus(): Promise<any> {
    if (isProxyEnabled()) return executeOnProxy("nzbget", "getStatus");
    return callNZBGetRPC("status");
}

async function callNZBGetRPC(method: string, params: any[] = []): Promise<any> {
    const baseUrl = process.env.NZBGET_URL?.trim() || "";
    const username = process.env.NZBGET_USERNAME?.trim() || "";
    const password = process.env.NZBGET_PASSWORD?.trim() || "";

    if (!baseUrl) {
        throw new Error("NZBGET_URL is not configured");
    }

    const auth = Buffer.from(`${username}:${password}`).toString("base64");
    const rpcUrl = baseUrl.endsWith("/") ? `${baseUrl}jsonrpc` : `${baseUrl}/jsonrpc`;

    const rpcPayload = {
        version: "1.1",
        method,
        params,
        id: 1
    };

    const response = await fetch(rpcUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Basic ${auth}`
        },
        body: JSON.stringify(rpcPayload)
    });

    if (!response.ok) {
        throw new Error(`NZBGet RPC request failed with status: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    if (data.error) {
        throw new Error(`NZBGet error: ${data.error.message}`);
    }

    return data.result;
}

export async function getVersion(): Promise<any> {
    if (isProxyEnabled()) return executeOnProxy("nzbget", "getVersion");
    return callNZBGetRPC("version");
}
