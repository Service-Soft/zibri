/**
 * How a backup of a valkey data source is read.
 *
 * - `'snapshot'`: every key copied at one moment, in one call, and the copies read a batch at a time.
 * A transaction committed while the backup is taken is in it whole or not at all, and so is a write past
 * the data source. The server answers nothing else while it copies, and needs the memory for the copy
 * until it is read: a backup is refused when the server has less free, within its `maxmemory` or else
 * its machine's memory.
 * - `'walk'`: the keys a batch at a time, while the server goes on answering everything else, each as it
 * was when the backup began: a write through the data source copies the key it writes first, once, and
 * the backup reads that copy. A transaction committed while the backup is taken is in it whole or not at
 * all. A write past the data source, through `connection`, copies nothing; a backup that read two rows
 * holding the same unique value that way fails, and is not stored.
 *
 * Either way, a restore builds every entity's ids, indexes and uniques again from the rows it restored.
 */
export type ValKeyBackupMode = 'snapshot' | 'walk';