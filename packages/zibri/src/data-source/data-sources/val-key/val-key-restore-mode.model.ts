/**
 * How a restore of a valkey data source writes the backup.
 *
 * - `'staged'`: every key of the backup written beside what is stored first, then swapped in at one
 * moment, in one call. No reader sees part of the backup, and a restore that fails before the swap
 * changes nothing. The server holds the backup beside what it replaces until the swap, and answers
 * nothing else while it swaps.
 * - `'direct'`: what is stored deleted, and the keys of the backup written in its place a batch at a
 * time, while the server goes on answering. A reader meanwhile sees part of the backup, and a key
 * written meanwhile can stay beside it. The server needs no memory beyond what the backup holds. A
 * restore through the backup service that fails part way is put back from its snapshot.
 *
 * Either way, a restore builds every entity's ids, indexes and uniques again from the rows it restored.
 */
export type ValKeyRestoreMode = 'staged' | 'direct';