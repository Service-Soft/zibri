import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { EncryptionKey, EncryptionKeyStatus } from './encryption-key.model.ts';
import { EncryptionService } from './encryption.service.ts';
import { EncryptionString } from './encryption.utilities.ts';
import { AesGcmEncryptionStrategy } from './strategies/aes-gcm.encryption-strategy.ts';
import { EncryptionStrategyEntity } from './strategies/encryption-strategy-entity.model.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { Newable } from '../../types/newable.type.ts';

/**
 * What encrypting writes beside the value: the row saying which strategy is in use, and the key it
 * was encrypted with. Both are created on first use and reused for every encryption after it.
 *
 * Runs without a container, because what it counts is rows rather than statements.
 */

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: defaultTestServerEntities });

describe('the rows encrypting creates', () => {
    let server: StartedTestServer | undefined;
    let encryption: EncryptionService;
    let strategies: Repository<EncryptionStrategyEntity>;
    let keys: Repository<EncryptionKey>;

    // what several of these are about is the very first encryption a process performs, so both
    // halves of "first" have to be new each time: a fresh server for a service that has cached
    // nothing, and empty tables for it to read. The tables are emptied afterwards rather than a new
    // data source built, because the in memory store belongs to its class and a second class is a
    // second data source the application never declared
    beforeEach(async () => {
        server = await startTestServer({ dataSources: [dataSourceClass] });
        encryption = inject(ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE) as EncryptionService;
        strategies = inject(repositoryTokenFor(EncryptionStrategyEntity));
        keys = inject(repositoryTokenFor(EncryptionKey));
    }, 15000);

    afterEach(async () => {
        await keys.deleteAll({});
        await strategies.deleteAll({});
        await server?.shutdown();
    }, 15000);

    it('creates one strategy and one key, however many values are encrypted', async () => {
        await encryption.encrypt('a');
        await encryption.encrypt('b');
        await encryption.encrypt('c');

        expect(await strategies.count()).toBe(1);
        expect(await keys.count()).toBe(1);
    });

    it('reuses the row a named encryption created', async () => {
        // the first encryption naming its strategy is the case that used to leave the table with no
        // default row at all - and every unnamed encryption after it then wrote another one, because
        // the row was looked for by its status rather than by what identifies it
        expect(await strategies.count()).toBe(0);
        await encryption.encrypt('a', { strategy: AesGcmEncryptionStrategy });
        const afterNamed: number = await strategies.count();

        await encryption.encrypt('b');
        await encryption.encrypt('c');

        expect(await strategies.count()).toBe(afterNamed);
        expect(await keys.count()).toBe(1);
    });

    it('creates one strategy and one key for encryptions that arrive together', async () => {
        // the race the in flight guard closes: nothing here is awaited between the check and the
        // write, so every one of these finds no row and every one of them would write one
        await Promise.all(Array.from({ length: 8 }, (_, i) => encryption.encrypt(`value-${i}`)));

        expect(await strategies.count()).toBe(1);
        expect(await keys.count()).toBe(1);
    });

    it('marks the key it created as the default one', async () => {
        await encryption.encrypt('a');

        const stored: EncryptionKey[] = await keys.findAll();
        expect(stored.map(k => k.status)).toEqual([EncryptionKeyStatus.DEFAULT]);
    });

    it('decrypts what every one of them encrypted', async () => {
        const encrypted: EncryptionString[] = await Promise.all(
            Array.from({ length: 4 }, (_, i) => encryption.encrypt(`value-${i}`))
        );

        const decrypted: string[] = await Promise.all(encrypted.map(e => encryption.decrypt(e)));
        expect(decrypted).toEqual(['value-0', 'value-1', 'value-2', 'value-3']);
    });
});