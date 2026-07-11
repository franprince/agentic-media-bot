/**
 * Utility to route service calls through the Proxy API if configured.
 * When `USE_PROXY=true`, the `executeOnProxy` function sends an HTTP request
 * to the local Home PC proxy instead of running the logic directly on the Brain.
 */

export const isProxyEnabled = () => process.env.USE_PROXY === "true";

export async function executeOnProxy(
	service: string,
	method: string,
	args: any[] = [],
): Promise<any> {
	const proxyUrl = process.env.PROXY_URL;
	const proxySecret = process.env.PROXY_SECRET_KEY;

	if (!proxyUrl || !proxySecret) {
		throw new Error(
			"USE_PROXY is true, but PROXY_URL or PROXY_SECRET_KEY is missing in the environment.",
		);
	}

	const targetUrl = `${proxyUrl.replace(/\/$/, "")}/api/tool`;

	console.log(`[PROXY] Forwarding ${service}.${method} to ${targetUrl}`);

	const response = await fetch(targetUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${proxySecret}`,
		},
		body: JSON.stringify({ service, method, args }),
	});

	if (!response.ok) {
		let errorText = "Unknown Proxy Error";
		try {
			const errJson = (await response.json()) as any;
			errorText = errJson.error || errorText;
		} catch (_) {
			errorText = await response.text();
		}
		throw new Error(`Proxy Execution Error (${response.status}): ${errorText}`);
	}

	const data = (await response.json()) as any;
	if (!data.success) {
		throw new Error(`Proxy Execution Failed: ${data.error || "Unknown Error"}`);
	}

	return data.result;
}
