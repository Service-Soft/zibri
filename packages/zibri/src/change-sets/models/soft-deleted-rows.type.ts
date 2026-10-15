/**
 * Which soft deleted rows a call reaches: none of them (`exclude`), every one of them alongside the
 * rest (`include`), or only them (`only`).
 */
export type SoftDeletedRows = 'exclude' | 'include' | 'only';