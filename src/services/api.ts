import { handleApiError, AppError } from "../utils/errors";

export interface FetchOptions extends RequestInit {
    params?: Record<string, string | number | boolean | undefined>;
}

export async function fetchService<T>(
    baseUrl: string,
    endpoint: string,
    apiKeyName: string,
    apiKeyValue: string,
    options: FetchOptions = {}
): Promise<T> {
    try {
        if (!baseUrl || !apiKeyValue) {
            throw new AppError(
                `Base URL or API key (${apiKeyName}) is not set.`,
                'CONFIG_ERROR',
                'api'
            );
        }

        const url = new URL(endpoint, baseUrl);

        // Add API key to params if provided (used by Radarr/Sonarr)
        if (apiKeyName === "apikey") {
            url.searchParams.append("apikey", apiKeyValue);
        }

        // Add custom params
        if (options.params) {
            Object.entries(options.params).forEach(([key, value]) => {
                if (value !== undefined) {
                    url.searchParams.append(key, String(value));
                }
            });
        }

        const response = await fetch(url.toString(), {
            ...options,
            headers: {
                "Accept": "application/json",
                "Content-Type": "application/json",
                ...(apiKeyName === "X-Plex-Token" ? { "X-Plex-Token": apiKeyValue } : {}),
                ...options.headers,
            },
        });

        if (!response.ok) {
            const error = new Error(response.statusText) as any;
            error.status = response.status;
            error.statusText = response.statusText;
            throw handleApiError(error, 'api', { url: url.pathname, method: options.method || 'GET' });
        }

        return response.json() as Promise<T>;
    } catch (error) {
        if (error instanceof AppError) {
            throw error;
        }
        throw handleApiError(error, 'api', { url: endpoint, method: options.method || 'GET' });
    }
}
