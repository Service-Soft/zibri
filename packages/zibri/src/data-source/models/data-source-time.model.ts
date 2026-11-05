/**
 * Marks a time as one `dataSourceNow` made.
 *
 * Declared and never assigned, so it exists only in the types: the one value carrying it is the one
 * `dataSourceNow` returns, which is what makes going through it the only way to write one down.
 */
declare const dataSourceTime: unique symbol;

/**
 * Stands for the time on the clock of the data source as it runs the statement, plus an offset.
 * Written with `dataSourceNow`.
 */
export type DataSourceTime = {
    /**
     * How far after the time of the data source it is, in milliseconds. Negative for before it.
     */
    readonly dataSourceNowPlusInMs: number,
    /**
     * Present in the type and in no value.
     */
    readonly [dataSourceTime]: true
};

/**
 * What a write takes for a property besides a value: the time of the data source, for a date property.
 */
export type DataSourceTimeFor<TValue> = NonNullable<TValue> extends Date ? DataSourceTime : never;

/**
 * Write data in which a date property can also be given the time of the data source.
 */
export type WithDataSourceTimes<Data> = {
    [K in keyof Data]: Data[K] | DataSourceTimeFor<Data[K]>
};