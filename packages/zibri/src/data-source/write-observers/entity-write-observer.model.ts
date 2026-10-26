import { Transaction } from '../transaction/transaction.model';

/**
 * Which operation of a driver a write is.
 */
export type WriteOperation = 'save' | 'insert' | 'updateEach' | 'updateAll' | 'upsert' | 'remove';

/**
 * What a write does to one row.
 */
export type RowWrite = {
    /**
     * What is written to it, undefined for a row the write removes.
     */
    data: object | undefined,
    /**
     * The row as it is, undefined for one the write creates. Of a write to every row a filter
     * matches, or of a removal, only the properties the observers of the entity name, and of the
     * former once per distinct set of values.
     */
    existing: object | undefined
};

/**
 * A write, as the operation it is and what it writes.
 */
export type EntityWrite = {
    /**
     * Which operation it is.
     */
    operation: WriteOperation,
    /**
     * What it writes, row by row. Of an upsert, what each row is created with and what it is set to
     * when it is there already. Nothing of a removal.
     */
    data: object[]
};

/**
 * A write about to be made, as an observer is asked to check it.
 */
export type ObservedWrite = EntityWrite & {
    /**
     * Resolves what the write does to each row, reading the rows as they are once per write, however
     * many observers ask.
     */
    resolveRowWrites: () => Promise<RowWrite[]>,
    /**
     * The transaction of the write, if any.
     */
    transaction: Transaction | undefined
};

/**
 * A committed write, with the rows it changed.
 */
export type WrittenRows = EntityWrite & {
    /**
     * The rows as they were, of a write an observer of the entity follows them of, none of any other.
     * Of a write to every row a filter matches, or of a removal, only the properties the observers
     * name.
     */
    before: object[],
    /**
     * The rows as they are now. Of a write to every row a filter matches, the rows as they were with
     * what it wrote over them.
     */
    after: object[]
};

/**
 * Checks every write to an entity before it is made, and follows it once it is committed, however the
 * repository above the store got to it.
 */
export type EntityWriteObserver = {
    /**
     * The properties of the rows as they were that it needs of a write to every row a filter matches,
     * or of a removal, which are read as these rather than as whole rows.
     */
    properties: string[],
    /**
     * Whether it follows the rows as they were of a write, which are read before it then. None when
     * absent.
     */
    followsBefore?: (write: EntityWrite) => boolean,
    /**
     * Refuses a write before anything is written, by throwing.
     */
    validateWrite?: (write: ObservedWrite) => Promise<void>,
    /**
     * Follows a write once it is committed, or once it is made when it runs in no transaction. What
     * it throws is logged, since the write stands either way.
     */
    handleWritten?: (written: WrittenRows) => Promise<void>
};
