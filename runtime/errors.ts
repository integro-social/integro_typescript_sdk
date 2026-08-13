import * as Types from "./types";

/**
 * Creates a success response
 */
export function createSuccess<T>(data: T): Types.Success<T> {
  return { ok: true, status: "success", data };
}

/**
 * Creates a network error response
 */
export function createNetworkError(message: string, error: Error, code: number = 500): Types.NetworkError {
  return { ok: false, code, status: "network_error", message, error };
}

/**
 * Creates a custom API error response
 */
export function createCustomError<T = string>(message: string, data: T, code: number): Types.CustomError<T> {
  return { ok: false, code, status: "api_error", message, data };
}

/**
 * Creates a parse error response (the request succeeded but the body could not be parsed)
 */
export function createParseError(message: string, error: Error, code: number): Types.ParseError {
  return { ok: false, code, status: "parse_error", message, error };
}

/**
 * Type guard to check if response is successful
 */
export function isSuccess<T>(response: Types.ApiResponse<T, any>): response is Types.Success<T> & { endpoint: string; method: Types.HttpMethod } {
  return response.ok === true;
}

/**
 * Type guard to check if response is an error
 */
export function isError<T>(response: Types.ApiResponse<any, T>): response is Types.Errors<T> & { endpoint: string; method: Types.HttpMethod } {
  return response.ok === false;
}
