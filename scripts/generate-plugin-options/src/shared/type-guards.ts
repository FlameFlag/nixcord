export const isString = (x: unknown): x is string => typeof x === 'string';
export const isNumber = (x: unknown): x is number => typeof x === 'number';
export const isBoolean = (x: unknown): x is boolean => typeof x === 'boolean';
export const isNull = (x: unknown): x is null => x === null;
export const isArray = Array.isArray;
export const isObject = (x: unknown): x is object =>
  typeof x === 'object' && x !== null && !isArray(x);
export const isNonNullObject = (x: unknown): x is object & { [k: string]: unknown } =>
  typeof x === 'object' && x !== null && !isArray(x);

export const isStringOrNumber = (x: unknown): x is string | number => isString(x) || isNumber(x);
export const isPrimitive = (x: unknown): x is string | number | boolean =>
  isString(x) || isNumber(x) || isBoolean(x);
