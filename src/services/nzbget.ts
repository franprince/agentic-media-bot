export async function getVersion(): Promise<any> {
    const baseUrl = process.env.NZBGET_URL?.trim() || "";
    const username = process.env.NZBGET_USERNAME?.trim() || "";
    const password = process.env.NZBGET_PASSWORD?.trim() || "";

    // Check if configuration exists
    if (!baseUrl) {
        throw new Error("NZBGET_URL is not configured");
    }

    const auth = Buffer.from(`${username}:${password}`).toString("base64");

    // NZBGet uses JSON-RPC
    const rpcPayload = {
        version: "1.1",
        method: "version",
        id: 1
    };

    // Make sure we form the correct JSON-RPC URL: <url>/jsonrpc
    const rpcUrl = baseUrl.endsWith("/") ? `${baseUrl}jsonrpc` : `${baseUrl}/jsonrpc`;

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
