import type { ZodError, ZodSchema } from 'zod';
import { fromZodError } from 'zod-validation-error';

export function parseOrThrow<T>(
  schema: ZodSchema<T>,
  data: unknown,
  ErrorClass: new (message: string) => Error,
  prefix?: string
): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const zodError = fromZodError(result.error);
  const message = prefix ? `${prefix}: ${zodError.message}` : zodError.message;
  throw new ErrorClass(message);
}
