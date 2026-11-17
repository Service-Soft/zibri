/**
 * True when two types are the same, false otherwise: neither may hold a value or a property the other lacks.
 *
 * Compared through two generic functions, because a plain `A extends B` lets `any` and a wider optional property
 * through.
 */
export type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;