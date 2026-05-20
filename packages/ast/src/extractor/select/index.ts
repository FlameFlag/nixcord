/**
 * Public surface for SELECT extraction. Keeps the top-level API tiny while the actual pattern
 * detectors live in options/, default/, and patterns/ submodules.
 */

export type { SelectDefaultResult, SelectOptionsResult } from '../types.js';
export { extractSelectDefault } from './default/index.js';
export { extractSelectOptions } from './options/index.js';
