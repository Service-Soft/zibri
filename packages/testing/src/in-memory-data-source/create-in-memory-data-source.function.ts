import { BaseEntity, DataSource, Newable } from 'zibri';

import { InMemoryDataSource } from './in-memory-data-source.model';
import { zibriFrameworkEntities } from '../framework-entities';
import { RoundTripCounter } from '../round-trip-counter.model';

/**
 * What can be configured about a data source built by {@link createInMemoryDataSource}.
 */
export type CreateInMemoryDataSourceOptions = {
    /**
     * The application's own entities.
     *
     * The framework's are added for you, so this is the same list the application's real data source
     * declares beside them.
     */
    entities?: Newable<BaseEntity>[],
    /**
     * Whether the built class may exist without an application using it.
     *
     * Needed only by a test that builds more than one and hands an application just one of them.
     */
    allowOrphan?: boolean,
    /**
     * Records every call a repository makes on the store, as `Entity.method`. One call is what one
     * request is to a store across the network.
     */
    roundTrips?: RoundTripCounter
};

/**
 * Builds a data source class that keeps everything in this process.
 *
 * The declaration a test would otherwise write by hand: a subclass of {@link InMemoryDataSource}
 * listing the framework's entities beside the application's.
 * @param options - The application's entities, whether the class may go unused, and where its calls
 * are recorded.
 * @param options.entities - The application's own entities. The framework's are added for you.
 * @param options.allowOrphan - Whether the built class may exist without an application using it.
 * @param options.roundTrips - Where every call a repository makes on the store is recorded.
 * @returns A data source class, ready to hand to `startTestServer` or to an application.
 */
export function createInMemoryDataSource({
    entities = [],
    allowOrphan = false,
    roundTrips
}: CreateInMemoryDataSourceOptions = {}): Newable<InMemoryDataSource> {
    // a set, because an application that declares one of the framework's entities itself - a custom
    // user entity extending the shipped one, say - would otherwise declare it twice
    const all: Newable<BaseEntity>[] = [...new Set([...zibriFrameworkEntities, ...entities])];

    /**
     * The data source this call stands for. A class per call, because a data source is identified
     * by its class and two applications must not share one.
     */
    @DataSource({ allowOrphan })
    class TestInMemoryDataSource extends InMemoryDataSource {
        override readonly entities: Newable<BaseEntity>[] = all;
        protected override readonly roundTrips: RoundTripCounter | undefined = roundTrips;
    }

    return TestInMemoryDataSource;
}