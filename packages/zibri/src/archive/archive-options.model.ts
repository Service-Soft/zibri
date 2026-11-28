import { ArchiveRetention } from './archive-retention.model';

/**
 * What the retention of a row of an archived entity is counted from: the end of the calendar year its date falls in,
 * or the date itself.
 */
export type ArchiveRetentionStart = 'endOfYear' | 'date';

/**
 * What `@Archive` takes: how long the rows of the entity are kept, from when, and where else their files are kept.
 */
export type ArchiveOptions<TDateKey extends string = string> = {
    /**
     * How long each row is kept, such as `{ years: 10 }`.
     */
    retention: ArchiveRetention,
    /**
     * What the retention is counted from. `'endOfYear'` by default, the end of the calendar year in the application's
     * default time zone, as § 147 AO counts it.
     */
    from?: ArchiveRetentionStart,
    /**
     * The date property of the entity the retention is counted from, such as `issuedAt`. When the row is created by
     * default.
     */
    dateProperty?: TDateKey,
    /**
     * The file stores each file of a row is copied into when the row is created, beside the store its property names,
     * such as `['offsite']`. A read falls back to a copy when the bytes of the file do not match. None by default.
     */
    copies?: string[]
};

/**
 * What `@Archive` stores of an entity.
 */
export type ArchiveMetadata = {
    /**
     * How long each row is kept.
     */
    retention: ArchiveRetention,
    /**
     * What the retention is counted from.
     */
    from: ArchiveRetentionStart,
    /**
     * The date property the retention is counted from, or undefined for when the row is created.
     */
    dateProperty: string | undefined,
    /**
     * The file stores each file of a row is copied into.
     */
    copies: string[]
};