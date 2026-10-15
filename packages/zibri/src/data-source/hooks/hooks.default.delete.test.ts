import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { type EncryptionServiceInterface } from '../../auth/encryption/encryption-service.interface';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Repository } from '../repository/repository';

/**
 * What deleting a row with an encrypted property spends on keys.
 *
 * The row is read and decrypted, because the delete hook sees it the way every other hook does. It
 * used to be encrypted again on its way to the store, so that the pass handing it back could decrypt
 * it once more - two key operations per value on a row that is about to stop existing, and on a
 * `deleteAll` that hands back nothing, on every row it removes.
 *
 * Runs without a container, because what it counts are calls on the encryption service.
 */

@Entity({ tenant: 'shared' })
class Locker extends BaseEntity {
    @Property.string()
    label!: string;

    @Property.string({ encryption: true })
    combination!: string;
}

let server: StartedTestServer | undefined;
let lockers: Repository<Locker>;
let encryption: EncryptionServiceInterface;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, Locker] })] });
    lockers = inject(repositoryTokenFor(Locker));
    encryption = inject(ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE);
}, 15000);

afterAll(async () => {
    await server?.shutdown();
}, 15000);

afterEach(() => {
    jest.restoreAllMocks();
});

/**
 * Creates lockers sharing one label, so a filter on it names exactly them.
 * @param label - The label.
 * @param count - How many.
 * @returns The lockers, as created.
 */
async function createLockers(label: string, count: number): Promise<Locker[]> {
    return await lockers.createAll(Array.from({ length: count }, (_, i) => ({ label, combination: `secret-${i}` })));
}

describe('deleting a row with an encrypted property', () => {
    it('decrypts it once for deleteById, and hands it back readable', async () => {
        const [locker] = await createLockers('by-id', 1);
        const encrypt: jest.SpiedFunction<EncryptionServiceInterface['encrypt']> = jest.spyOn(encryption, 'encrypt');
        const decrypt: jest.SpiedFunction<EncryptionServiceInterface['decrypt']> = jest.spyOn(encryption, 'decrypt');

        const deleted: Locker = await lockers.deleteById(locker?.id ?? '');

        expect(deleted.combination).toBe('secret-0');
        expect(encrypt).not.toHaveBeenCalled();
        expect(decrypt).toHaveBeenCalledTimes(1);
        await expect(lockers.findById(deleted.id, { required: false })).resolves.toBeUndefined();
    });

    it('decrypts each row once for deleteAll, and encrypts none of them', async () => {
        await createLockers('counted', 3);
        const encrypt: jest.SpiedFunction<EncryptionServiceInterface['encrypt']> = jest.spyOn(encryption, 'encrypt');
        const decrypt: jest.SpiedFunction<EncryptionServiceInterface['decrypt']> = jest.spyOn(encryption, 'decrypt');

        expect(await lockers.deleteAll({ label: 'counted' })).toBe(3);

        expect(encrypt).not.toHaveBeenCalled();
        expect(decrypt).toHaveBeenCalledTimes(3);
    });

    it('hands back readable rows for deleteAll asked for them, decrypting each once', async () => {
        await createLockers('returned', 2);
        const encrypt: jest.SpiedFunction<EncryptionServiceInterface['encrypt']> = jest.spyOn(encryption, 'encrypt');
        const decrypt: jest.SpiedFunction<EncryptionServiceInterface['decrypt']> = jest.spyOn(encryption, 'decrypt');

        const deleted: Locker[] = await lockers.deleteAll({ label: 'returned' }, { returnDeleted: true });

        expect(deleted.map(d => d.combination).sort()).toEqual(['secret-0', 'secret-1']);
        expect(encrypt).not.toHaveBeenCalled();
        expect(decrypt).toHaveBeenCalledTimes(2);
    });
});