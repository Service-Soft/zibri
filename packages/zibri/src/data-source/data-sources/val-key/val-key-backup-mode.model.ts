/**
 * How a backup of a valkey data source is read.
 *
 * - `'snapshot'`: every key at one moment, in one call. A transaction committed while the backup is
 * taken is in it whole or not at all. The server answers nothing else while it reads, and holds the
 * whole backup in memory once to send it.
 * - `'walk'`: the keys a batch at a time, while the server goes on answering everything else. A
 * transaction committed while the backup is taken can be in it with some of its rows and without
 * others.
 *
 * Either way, a restore builds every entity's ids, indexes and uniques again from the rows it restored.
 */
export type ValKeyBackupMode = 'snapshot' | 'walk';