import type { GlideClient } from '@valkey/valkey-glide';

import { RoundTripCounter } from './round-trip-counter.model';
import { ValKeyDataSource, ValKeyOptions } from '../../data-source/data-sources/val-key/val-key-data-source.model';
import { DataSource } from '../../data-source/decorators/data-source.decorator';
import { MigrationEntity } from '../../data-source/migration/migration-entity.model';
import { Migration } from '../../data-source/migration/migration.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';
import { UUIDUtilities } from '../../utilities/uuid.utilities';

export type CreateTestValKeyDataSourceOptions = {
    /**
     * The entities of the data source. Needs to include the MigrationEntity.
     */
    entities?: Newable<BaseEntity>[],
    /**
     * The migrations of the data source.
     */
    migrations?: Newable<Migration>[],
    /**
     * The host of the valkey server, the port is filled in by the test server.
     */
    host?: string,
    /**
     * Records every call the data source makes on its client. A batch or a script is one call, since
     * it is sent as one request.
     *
     * Only a suite measuring what a call costs sets this, on a data source holding nothing but the
     * entities it measures, so that no service of the application adds calls of its own.
     */
    roundTrips?: RoundTripCounter
};

/**
 * The entities that a valkey test data source needs at the very least.
 */
export const defaultTestValKeyEntities: Newable<BaseEntity>[] = [MigrationEntity];

/**
 * Creates a valkey data source class that can be handed to startTestServer.
 *
 * Every data source class gets its own random key prefix so that tests which share a container
 * cannot see the keys of each other. One per class rather than per instance, so that a server
 * re-initialized on it finds what it stored, as a restarted application does.
 * @param options - The options of the data source to create.
 * @returns A newable valkey data source.
 */
export function createTestValKeyDataSource(
    options: CreateTestValKeyDataSourceOptions = {}
): Newable<ValKeyDataSource & { entities: Newable<BaseEntity>[] }> {
    const {
        entities = defaultTestValKeyEntities,
        migrations = [],
        host = 'localhost',
        roundTrips
    } = options;
    const keyPrefix: string = `test-${UUIDUtilities.generate()}`;

    @DataSource()
    class ValKeyDbDataSource extends ValKeyDataSource {
        override options: ValKeyOptions = {
            host,
            // the container serves no tls
            useTLS: false,
            keyPrefix
        };
        entities: Newable<BaseEntity>[] = entities;
        override migrations: Newable<Migration>[] = migrations;

        override async init(): Promise<void> {
            await super.init();
            if (roundTrips != undefined && this.client != undefined) {
                this.client = countingClient(this.client, roundTrips);
            }
        }
    }

    return ValKeyDbDataSource;
}

/**
 * Wraps a client so that every call made on it is recorded.
 *
 * A method is run against the client itself rather than the wrapper, so the calls one method makes
 * internally are not counted again: what is counted is what the data source asked for, which is one
 * request each.
 * @param client - The client to wrap.
 * @param roundTrips - Where the calls are recorded.
 * @returns The wrapped client.
 */
function countingClient(client: GlideClient, roundTrips: RoundTripCounter): GlideClient {
    return new Proxy(client, {
        get: (target, property, receiver) => {
            const value: unknown = Reflect.get(target, property, receiver);
            if (typeof value !== 'function') {
                return value;
            }
            return (...args: unknown[]) => {
                roundTrips.record();
                const res: unknown = Reflect.apply(value, target, args);
                return res;
            };
        }
    });
}