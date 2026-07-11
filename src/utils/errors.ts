/**
 * Centralized error handling utilities for consistent error management across services
 */

export interface ServiceError {
	message: string;
	code?: string;
	service?: string;
	timestamp: string;
	context?: Record<string, any>;
}

export class AppError extends Error {
	public readonly code: string;
	public readonly service?: string;
	public readonly context?: Record<string, any>;
	public readonly timestamp: string;

	constructor(
		message: string,
		code: string = "UNKNOWN_ERROR",
		service?: string,
		context?: Record<string, any>,
	) {
		super(message);
		this.name = "AppError";
		this.code = code;
		this.service = service;
		this.context = context;
		this.timestamp = new Date().toISOString();
	}
}

/**
 * Create a standardized error object for logging
 */
export function createServiceError(
	error: Error | string,
	service: string,
	code?: string,
	context?: Record<string, any>,
): ServiceError {
	const message = typeof error === "string" ? error : error.message;
	const errorCode =
		code ||
		(typeof error === "object" && "code" in error
			? (error as any).code
			: "UNKNOWN_ERROR");

	return {
		message,
		code: errorCode,
		service,
		timestamp: new Date().toISOString(),
		context: context || {},
	};
}

/**
 * Log service errors with consistent format
 */
export function logServiceError(error: ServiceError): void {
	console.error(`[${error.service}] Error:`, {
		message: error.message,
		code: error.code,
		timestamp: error.timestamp,
		context: error.context,
	});
}

/**
 * Handle API errors consistently across services
 */
export function handleApiError(
	error: any,
	service: string,
	context?: Record<string, any>,
): AppError {
	if (error instanceof AppError) {
		return error;
	}

	if (typeof error === "string") {
		return new AppError(error, "API_ERROR", service, context);
	}

	// Handle fetch errors
	if (error instanceof Error) {
		if (error.name === "AbortError") {
			return new AppError("Request timeout", "TIMEOUT_ERROR", service, context);
		}

		if (error.message.includes("fetch")) {
			return new AppError("Network error", "NETWORK_ERROR", service, context);
		}

		if (error.message.includes("ECONNREFUSED")) {
			return new AppError(
				"Connection refused",
				"CONNECTION_ERROR",
				service,
				context,
			);
		}

		// Handle HTTP status errors
		if ("status" in error) {
			const status = (error as any).status;
			const statusText = (error as any).statusText || "Unknown error";
			return new AppError(
				`HTTP ${status}: ${statusText}`,
				"HTTP_ERROR",
				service,
				{ ...context, status, statusText },
			);
		}
	}

	return new AppError(
		error?.message || "Unknown error occurred",
		"UNKNOWN_ERROR",
		service,
		context,
	);
}

/**
 * Create a user-friendly error message for API responses
 */
export function createUserErrorMessage(error: AppError): string {
	switch (error.code) {
		case "TIMEOUT_ERROR":
			return "The request took too long. Please try again.";
		case "NETWORK_ERROR":
			return "Network connection failed. Please check your internet connection.";
		case "CONNECTION_ERROR":
			return "Unable to connect to the service. Please check if the service is running.";
		case "HTTP_ERROR":
			if (error.context?.status === 401) {
				return "Authentication failed. Please check your API credentials.";
			}
			if (error.context?.status === 403) {
				return "Access denied. Please check your permissions.";
			}
			if (error.context?.status === 404) {
				return "The requested resource was not found.";
			}
			if (error.context?.status >= 500) {
				return "The service is currently unavailable. Please try again later.";
			}
			return `Service error: ${error.message}`;
		default:
			return error.message || "An unexpected error occurred.";
	}
}
