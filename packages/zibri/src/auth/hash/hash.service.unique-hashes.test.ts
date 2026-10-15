import { describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { ScryptHashStrategy } from './strategies/scrypt.hash-strategy';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';

/**
 * Which hashed properties a unique declaration can be about.
 *
 * A unique declaration compares what is stored, and a salted hash of one value is stored differently
 * every time, so the declaration rejects nothing. Only the built strategy says whether it hashes one
 * value the same way twice, so the hash service decides it when the application starts. The default
 * entities already hold the case that has to start: refresh tokens are unique and hashed with a
 * deterministic strategy, and every boot in this repository declares them.
 *
 * Runs without a container, because the boot is refused before anything is stored.
 */

@Entity({ tenant: 'shared', allowOrphan: true })
class Badge extends BaseEntity {
    @Property.string({ unique: true, hash: { strategy: ScryptHashStrategy } })
    pin!: string;

    @Property.string({ unique: true, hash: true })
    secret!: string;
}

describe('a unique declaration on a hashed property', () => {
    it('refuses to start when the strategy hashing it is salted, the default one included', async () => {
        const start: Promise<unknown> = startTestServer({
            dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, Badge], allowOrphan: true })]
        });

        await expect(start).rejects.toThrow('Error initializing hash service');
        await expect(start).rejects.toThrow('Badge.pin, hashed with "scrypt"');
        await expect(start).rejects.toThrow('Badge.secret, hashed with "scrypt"');
    }, 30000);
});