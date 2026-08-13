/**
 * Response configuration - phantom type marker for type inference
 */
export type ResponseConfig<TResponse> = {
  _response?: TResponse; // Phantom type marker
};

// Type inference helper
export type InferResult<T> = T extends ResponseConfig<infer TResponse> ? TResponse : never;

/**
 * Create a response configuration (phantom type marker)
 */
export function create<TResponse>(): ResponseConfig<TResponse> {
  return {} as ResponseConfig<TResponse>;
}
