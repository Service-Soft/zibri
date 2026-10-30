import { EntitySnapshot } from './entity-snapshot.model';

/**
 * What `zi migrate create` asks of an application, in the file it hands the application.
 */
export type MigrationGenerationRequest = {
    /**
     * The name the migrations are given, derived from what each changes when there is none.
     */
    name?: string,
    /**
     * The data source to write a migration for that changes nothing, in place of one per data source
     * whose entities changed.
     */
    emptyFor?: string,
    /**
     * Whether to write the snapshot of every data source that has none, in place of migrations, for
     * a database that holds what the entities declare already.
     */
    baseline?: boolean,
    /**
     * Every data source of the project, by the name of its class.
     */
    dataSources: Record<string, {
        /**
         * Where a migration of it imports its class from.
         */
        import: string,
        /**
         * The snapshot committed with its migrations so far, none before its first.
         */
        snapshot?: EntitySnapshot
    }>
};

/**
 * What an application answers `zi migrate create`, in the file it was handed for it.
 */
export type MigrationGenerationResponse = {
    /**
     * The migrations written, one per data source whose entities changed.
     */
    migrations: {
        /**
         * The name of the data source's class.
         */
        dataSource: string,
        /**
         * The name of the migration's class.
         */
        className: string,
        /**
         * The name of its file.
         */
        fileName: string,
        /**
         * Its code.
         */
        code: string,
        /**
         * The snapshot to commit with it, none when an empty migration is written before the first.
         */
        snapshot?: EntitySnapshot
    }[],
    /**
     * The snapshots written in place of migrations for a baseline, one per data source that had none.
     */
    baselines?: {
        /**
         * The name of the data source's class.
         */
        dataSource: string,
        /**
         * The snapshot to commit.
         */
        snapshot: EntitySnapshot
    }[]
};