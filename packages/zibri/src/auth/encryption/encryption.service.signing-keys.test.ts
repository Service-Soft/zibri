import assert from 'node:assert';
import { createHash } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { createInMemoryDataSource, testMasterKey } from 'zibri-testing';

import { EncryptionMasterKey } from './encryption-master-options.model';
import { EncryptionServiceInterface } from './encryption-service.interface';
import { EncryptionString, EncryptionUtilities } from './encryption.utilities';
import { SigningKey, SigningKeyCreateData } from './signing-key.model';
import { AesGcmEncryptionStrategy } from './strategies/aes-gcm.encryption-strategy';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';

const replacementMasterKey: EncryptionMasterKey<Buffer> = {
    id: 'mk2',
    value: createHash('sha256').update('zibri-test-replacement-master-key')
        .digest()
};

/**
 * The encryption service of the running application.
 * @returns The service.
 */
function getEncryptionService(): EncryptionServiceInterface {
    return inject(ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE);
}

/**
 * The repository of the signing keys of the running application.
 * @returns The repository.
 */
function getSigningKeyRepository(): Repository<SigningKey, SigningKeyCreateData> {
    return inject(repositoryTokenFor(SigningKey));
}

/**
 * The id of the master key a stored signing key is encrypted under.
 * @param name - The name of the signing key.
 * @returns The id.
 */
async function findMasterKeyIdOf(name: string): Promise<string> {
    const stored: SigningKey = await getSigningKeyRepository().findOne({ where: { name } });
    return EncryptionUtilities.encryptionStringToContent(stored.value).keyId;
}

describe('EncryptionService — signing keys', () => {
    let server: StartedTestServer | undefined;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })]
        });
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    test('gives one key per name, the same every time, and stores it under the master key', async () => {
        const first: Buffer = await getEncryptionService().resolveSigningKey('chain');
        const again: Buffer = await getEncryptionService().resolveSigningKey('chain');
        const other: Buffer = await getEncryptionService().resolveSigningKey('webhooks');

        expect(first).toHaveLength(32);
        expect(again.equals(first)).toBe(true);
        expect(other.equals(first)).toBe(false);
        const stored: SigningKey = await getSigningKeyRepository().findOne({ where: { name: 'chain' } });
        expect(stored.value).not.toContain(first.toString('base64'));
        expect(await findMasterKeyIdOf('chain')).toBe(testMasterKey.id);
    });

    test('keeps the key through a new master key, rewriting it under the new one while the application starts', async () => {
        assert(server, 'the server did not start');
        const before: Buffer = await getEncryptionService().resolveSigningKey('chain');
        // what an instance that has not been given the new master key yet writes during a rolling deploy
        await getSigningKeyRepository().create({ name: 'late', value: await getEncryptionService().masterEncrypt(Buffer.alloc(32, 7).toString('base64')) });

        await server.reInit({
            providers: [
                ...defaultTestServerProviders,
                defineProvider({
                    token: ZIBRI_DI_TOKENS.ENCRYPTION_MASTER_OPTIONS,
                    useValue: {
                        currentMasterStrategy: new AesGcmEncryptionStrategy(),
                        currentMasterKey: replacementMasterKey,
                        oldMasterKeys: [testMasterKey]
                    }
                })
            ]
        });

        expect((await getEncryptionService().resolveSigningKey('chain')).equals(before)).toBe(true);
        expect(await findMasterKeyIdOf('chain')).toBe(replacementMasterKey.id);
        expect((await getEncryptionService().resolveRetiredKeyUsage()).masterKeys)
            .toEqual([{ keyId: testMasterKey.id, dataKeys: 0, signingKeys: 0, backups: 0 }]);

        // written under the old one after this instance rewrote the others
        await getSigningKeyRepository().create({ name: 'later', value: await encryptUnder(testMasterKey) });
        expect((await getEncryptionService().resolveRetiredKeyUsage()).masterKeys)
            .toEqual([{ keyId: testMasterKey.id, dataKeys: 0, signingKeys: 1, backups: 0 }]);
    }, 30000);
});

/**
 * Encrypts a fresh key under the given master key, the way an instance still configured with it does.
 * @param masterKey - The master key.
 * @returns The encrypted key.
 */
async function encryptUnder(masterKey: EncryptionMasterKey<Buffer>): Promise<EncryptionString> {
    return await new AesGcmEncryptionStrategy().encrypt(Buffer.alloc(32, 9).toString('base64'), { key: masterKey.value, keyId: masterKey.id });
}