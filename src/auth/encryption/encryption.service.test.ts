import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';

import { EncryptionKey } from './encryption-key.model';
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
    });

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
});