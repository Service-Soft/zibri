import { afterAll, beforeAll, describe, expect, jest, test } from '@jest/globals';

import { EncryptionKey, EncryptionKeyStatus } from './encryption-key.model';
import { EncryptionService } from './encryption.service';
import { EncryptionString } from './encryption.utilities';
import { AesGcmEncryptionStrategy } from './strategies/aes-gcm.encryption-strategy';
import { EncryptionStrategyEntity } from './strategies/encryption-strategy-entity.model';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../data-source/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';

describe('EncryptionService', () => {
    let server: StartedTestServer;
    let encryptionService: EncryptionService;
    let strategyRepository: Repository<EncryptionStrategyEntity>;
    let keyRepository: Repository<EncryptionKey>;

    beforeAll(async () => {
        server = await startTestServer();
        strategyRepository = inject(repositoryTokenFor(EncryptionStrategyEntity));
        keyRepository = inject(repositoryTokenFor(EncryptionKey));
        encryptionService = inject(ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE) as EncryptionService;
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    test('creates strategy metadata and key metadata on first encrypt', async () => {
        const strategiesBeforeEncryption: EncryptionStrategyEntity[] = await strategyRepository.findAll();
        expect(strategiesBeforeEncryption.length).toBe(0);

        const encrypted: string = await encryptionService.encrypt('hello');
        expect(encrypted).toBeTruthy();

        const strategies: EncryptionStrategyEntity[] = await strategyRepository.findAll();
        const keys: EncryptionKey[] = await keyRepository.findAll();

        expect(strategies.length).toBeGreaterThan(0);
        expect(keys.length).toBeGreaterThan(0);
    });

    test('decrypts an encrypted value', async () => {
        const encrypted: EncryptionString = await encryptionService.encrypt('secret');

        await expect(encryptionService.decrypt(encrypted)).resolves.toBe('secret');
    });

    test('does not duplicate key metadata on repeated encryptions with same strategy', async () => {
        await encryptionService.encrypt('first');
        await encryptionService.encrypt('second');

        const keys: EncryptionKey[] = await keyRepository.findAll();
        expect(keys).toHaveLength(1);
    });

    test('fails with invalid aad', async () => {
        const encrypted: EncryptionString = await encryptionService.encrypt(
            'secret',
            { strategy: AesGcmEncryptionStrategy, strategyOptions: { aad: 'userId:42' } }
        );
        await expect(encryptionService.decrypt(encrypted)).rejects.toThrow();
        await expect(encryptionService.decrypt(encrypted, { aad: 'userId:42' })).resolves.toBe('secret');
    });

    describe('key management', () => {
        test('createKey adds a new ACTIVE key without disturbing the current default', async () => {
            // establish the initial default key
            await encryptionService.encrypt('bootstrap');
            const before: EncryptionKey[] = await keyRepository.findAll();
            const defaultBefore: EncryptionKey | undefined = before.find(k => k.status === EncryptionKeyStatus.DEFAULT);
            expect(defaultBefore).toBeDefined();

            const created: EncryptionKey = await encryptionService.createKey(AesGcmEncryptionStrategy, {
                status: EncryptionKeyStatus.ACTIVE
            });

            expect(created.status).toBe(EncryptionKeyStatus.ACTIVE);
            const afterDefault: EncryptionKey = await keyRepository.findById((defaultBefore as EncryptionKey).id);
            expect(afterDefault.status).toBe(EncryptionKeyStatus.DEFAULT);
        });

        test('createKey with status DEFAULT demotes the previous default key to ACTIVE', async () => {
            await encryptionService.encrypt('bootstrap-2');
            const before: EncryptionKey[] = await keyRepository.findAll();
            const previousDefault: EncryptionKey = before.find(k => k.status === EncryptionKeyStatus.DEFAULT) as EncryptionKey;

            const newDefault: EncryptionKey = await encryptionService.createKey(AesGcmEncryptionStrategy, {
                status: EncryptionKeyStatus.DEFAULT
            });

            expect(newDefault.status).toBe(EncryptionKeyStatus.DEFAULT);
            const demoted: EncryptionKey = await keyRepository.findById(previousDefault.id);
            expect(demoted.status).toBe(EncryptionKeyStatus.ACTIVE);
        });

        test('deleteKey throws when deleting the default key without allowDefault', async () => {
            await encryptionService.encrypt('bootstrap-3');
            const keys: EncryptionKey[] = await keyRepository.findAll();
            const defaultKey: EncryptionKey = keys.find(k => k.status === EncryptionKeyStatus.DEFAULT) as EncryptionKey;

            await expect(encryptionService.deleteKey(defaultKey.id)).rejects.toThrow(/Cannot delete the default key/);
        });

        test('deleteKey succeeds for the default key when allowDefault is true', async () => {
            await encryptionService.encrypt('bootstrap-4');
            const keys: EncryptionKey[] = await keyRepository.findAll();
            const defaultKey: EncryptionKey = keys.find(k => k.status === EncryptionKeyStatus.DEFAULT) as EncryptionKey;

            await expect(encryptionService.deleteKey(defaultKey.id, { allowDefault: true })).resolves.toBeUndefined();
            await expect(keyRepository.findById(defaultKey.id)).rejects.toThrow();
        });

        test('deleteKey succeeds for a non-default key without allowDefault', async () => {
            await encryptionService.encrypt('bootstrap-5');
            const created: EncryptionKey = await encryptionService.createKey(AesGcmEncryptionStrategy, {
                status: EncryptionKeyStatus.ACTIVE
            });

            await expect(encryptionService.deleteKey(created.id)).resolves.toBeUndefined();
        });

        test('markKeyAsDefaultForStrategy promotes the given key and demotes the previous default', async () => {
            // ensure a deterministic default key regardless of state left behind by earlier tests in this file
            const previousDefault: EncryptionKey = await encryptionService.createKey(AesGcmEncryptionStrategy, {
                status: EncryptionKeyStatus.DEFAULT
            });

            const candidate: EncryptionKey = await encryptionService.createKey(AesGcmEncryptionStrategy, {
                status: EncryptionKeyStatus.ACTIVE
            });

            await encryptionService.markKeyAsDefaultForStrategy(candidate.id, AesGcmEncryptionStrategy);

            const promoted: EncryptionKey = await keyRepository.findById(candidate.id);
            const demoted: EncryptionKey = await keyRepository.findById(previousDefault.id);
            expect(promoted.status).toBe(EncryptionKeyStatus.DEFAULT);
            expect(demoted.status).toBe(EncryptionKeyStatus.ACTIVE);
        });
    });

    describe('EncryptionKeyCache behavior', () => {
        test('caches key lookups so repeated decrypt calls for the same key hit the repository only once', async () => {
            const encrypted: EncryptionString = await encryptionService.encrypt('cache-read-test');
            // the key was already written to the cache by createKeyEntity's @CacheWrite when it was created above
            const findByIdSpy: jest.SpiedFunction<typeof keyRepository.findById> = jest.spyOn(keyRepository, 'findById');

            await encryptionService.decrypt(encrypted);
            await encryptionService.decrypt(encrypted);
            await encryptionService.decrypt(encrypted);

            expect(findByIdSpy).not.toHaveBeenCalled();
            findByIdSpy.mockRestore();
        });

        test('updateKey refreshes the cache instead of leaving a stale entry behind', async () => {
            const created: EncryptionKey = await encryptionService.createKey(AesGcmEncryptionStrategy, {
                status: EncryptionKeyStatus.ACTIVE
            });
            await encryptionService.markKeyAsDefaultForStrategy(created.id, AesGcmEncryptionStrategy);

            const findByIdSpy: jest.SpiedFunction<typeof keyRepository.findById> = jest.spyOn(keyRepository, 'findById');
            // resolves the newly-promoted default key purely from cache, proving markKeyAsDefaultForStrategy's
            // updateKeyEntityById call (@CacheWrite) refreshed the cache rather than just updating the database
            const encrypted: EncryptionString = await encryptionService.encrypt('cache-write-test', {
                strategy: AesGcmEncryptionStrategy
            });
            await encryptionService.decrypt(encrypted);

            expect(findByIdSpy).not.toHaveBeenCalled();
            findByIdSpy.mockRestore();
        });

        test('deleteKey removes the entry from the cache instead of leaving a deleted key resolvable', async () => {
            const created: EncryptionKey = await encryptionService.createKey(AesGcmEncryptionStrategy, {
                status: EncryptionKeyStatus.ACTIVE
            });
            const encrypted: EncryptionString = await encryptionService.encrypt('cache-delete-test', {
                strategy: AesGcmEncryptionStrategy,
                strategyOptions: { keyId: created.id }
            });

            await encryptionService.deleteKey(created.id);

            // if the cache entry survived the delete, decrypt would silently succeed using the stale cached key
            await expect(encryptionService.decrypt(encrypted)).rejects.toThrow();
        });
    });
});