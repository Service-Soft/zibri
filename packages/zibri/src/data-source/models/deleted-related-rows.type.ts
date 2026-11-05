/**
 * What a write does with a soft deleted row it is given by its id as a row of a `oneToMany` or
 * `hasOne` relation: refuses it with a `ConflictError` naming the row, or restores it as a restore
 * does, the rows deleted along with it included, and writes it.
 */
export type DeletedRelatedRows = 'refuse' | 'restore';