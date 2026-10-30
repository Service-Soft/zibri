import { Migration, Newable } from 'zibri';

/**
 * The migrations of the data source, in the order they run. "zi migrate create" adds each one it
 * writes.
 */
export const migrations: Newable<Migration>[] = [];