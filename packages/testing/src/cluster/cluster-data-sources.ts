import { BaseEntity, DataSourceInterface, Newable } from 'zibri';

import { ClusterMark } from './cluster-mark.model';
import { createPostgresTestDataSource } from '../create-postgres-test-data-source.function';
import { zibriFrameworkEntities } from '../framework-entities';

/**
 * The entities a cluster instance declares unless it names its own.
 *
 * {@link ClusterMark} on top of the framework's, because an instance that cannot record which
 * instance did the work cannot be asserted about - and every cluster test is a question about which
 * replica acted.
 */
export const defaultClusterTestEntities: Newable<BaseEntity>[] = [...zibriFrameworkEntities, ClusterMark];

/**
 * The data sources a cluster boots on unless its instance options name their own.
 *
 * Postgres rather than in process, and that is the whole reason a cluster needs a container at all:
 * the instances are separate processes, so the store has to be something outside all of them.
 *
 * Built once at module load and shared, rather than per call: every call to
 * {@link createPostgresTestDataSource} makes a new class, and the parent process and each instance
 * have to agree on how many data sources there are and in which order - that is what the mapped
 * ports are indexed by. Both sides reach this through the same module, so both get the same array.
 *
 * `allowOrphan`, because an instance options module that names its own data sources still imports
 * this one for whatever else it needs, and a data source that is declared and never deployed is
 * refused by name.
 */
export const defaultClusterDataSources: Newable<DataSourceInterface>[] = [
    // needs to be distributed
    createPostgresTestDataSource({ entities: defaultClusterTestEntities, allowOrphan: true })
];