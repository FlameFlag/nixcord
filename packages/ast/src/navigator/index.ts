/**
 * Navigator layer for AST traversal and pattern matching.
 *
 * This layer provides pure navigation functions that find and traverse
 * nodes in the AST without extracting values. Navigation logic is separated
 * from extraction logic, making it easier to adapt to different plugin
 * structures (Vencord, Equicord, or future frameworks).
 */

export * from './node-traversal.js';
export * from './pattern-matcher.js';
export * from './plugin-navigator.js';
