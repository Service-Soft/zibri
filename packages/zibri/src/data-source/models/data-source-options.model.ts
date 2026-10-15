import { DataSourceOptions as TODataSourceOptions } from 'typeorm';

/**
 * Options for defining a data source.
 */
export type DataSourceOptions = TODataSourceOptions & {
    /**
     * How many values one statement can bind. Defaults to what the database accepts.
     *
     * A write of more rows than one statement can take is split into several statements, each within
     * this, and runs inside one transaction.
     */
    maxBoundValuesPerStatement?: number
};

/**
 * Options of a data source with its defaults applied, so that every option that has a default is set.
 */
export type ResolvedDataSourceOptions<TOptions> = TOptions & Required<Pick<DataSourceOptions, 'maxBoundValuesPerStatement'>>;