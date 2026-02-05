/**
 * Public surface for SELECT extraction. Keeps the top-level API tiny while the actual pattern
 * detectors live in options/, default/, and patterns/ submodules.
 */

export { extractSelectOptions } from './options/index.js';
export { extractSelectDefault } from './default/index.js';

export type { SelectOptionsResult, SelectDefaultResult } from '../types.js';
