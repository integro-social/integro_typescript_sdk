export type ResponseConfig<TResponse> = {
  _response?: TResponse; // Phantom type marker
};

export type InferResult<T> = T extends ResponseConfig<infer TResponse> ? TResponse : never;

export function create<TResponse>(): ResponseConfig<TResponse> {
  return {} as ResponseConfig<TResponse>;
}
