export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const Err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const isOk = <T, E>(r: Result<T, E>): r is { readonly ok: true; readonly value: T } => r.ok;
export const isErr = <T, E>(r: Result<T, E>): r is { readonly ok: false; readonly error: E } =>
  !r.ok;
export const map = <T, E, U>(r: Result<T, E>, fn: (v: T) => U): Result<U, E> =>
  r.ok ? Ok(fn(r.value)) : r;
export const flatMap = <T, E, U>(r: Result<T, E>, fn: (v: T) => Result<U, E>): Result<U, E> =>
  r.ok ? fn(r.value) : r;
export const unwrapOr = <T, E>(r: Result<T, E>, fallback: T): T => (r.ok ? r.value : fallback);
