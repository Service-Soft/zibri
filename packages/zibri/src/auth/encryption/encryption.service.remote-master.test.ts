import { CipherGCM, createCipheriv, createDecipheriv, DecipherGCM, randomBytes } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { EncryptionKey } from './encryption-key.model';
import { EncryptionMasterOptions } from './encryption-master-options.model';
import { EncryptionContent, EncryptionString, EncryptionUtilities } from './encryption.utilities';
import { AesGcmEncryptionStrategy } from './strategies/aes-gcm.encryption-strategy';
import { BaseDecryptOptions, BaseEncryptOptions, EncryptionStrategyInterface } from './strategies/encryption-strategy.interface';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders, testMasterKey } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { Newable } from '../../types/newable.type';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { OtpCredentials } from '../2fa/methods/otp/otp-credentials.model';

// a master key belongs in a kms or an hsm, which hands an application a reference and never the
// bytes: this is a master strategy built that way, standing in for one

/**
 * What a strategy backed by a kms or an hsm is handed instead of key material.
 */
type RemoteKeyHandle = {
    /**
     * What the remote store knows this key as. An arn, a label, a slot - never the bytes.
     */
    keyRef: string
};

const remoteMasterKeyRef: string = 'projects/zibri/keys/master';

/**
 * Stands in for the key store a kms would be.
 *
 * Reachable from nothing the framework touches: the only thing crossing into the application is
 * `remoteMasterKeyRef`.
 */
const remoteKeyStore: Map<string, Buffer> = new Map([[remoteMasterKeyRef, randomBytes(32)]]);

/**
 * A master strategy whose key never enters the process.
 *
 * Written out rather than wrapping `AesGcmEncryptionStrategy`, because what is shown is that
 * `EncryptionStrategyInterface` is implementable by something that resolves its key elsewhere and
 * answers asynchronously - and reusing the builtin would hide exactly that.
 */
class RemoteMasterStrategy implements EncryptionStrategyInterface<RemoteKeyHandle> {
    readonly name: string = 'remote-kms';
    readonly version: string = 'v1';
    readonly usableInMigrations: boolean = false;

    async encrypt(value: string, options: BaseEncryptOptions<RemoteKeyHandle>): Promise<EncryptionString> {
        const key: Buffer = await this.resolve(options.key);
        const iv: Buffer = randomBytes(12);
        const cipher: CipherGCM = createCipheriv('aes-256-gcm', key, iv);
        const encrypted: Buffer = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);

        return EncryptionUtilities.contentToEncryptionString({
            strategyName: this.name,
            version: this.version,
            keyId: options.keyId,
            encryptedValue: [
                iv.toString('base64'),
                cipher.getAuthTag().toString('base64'),
                encrypted.toString('base64')
            ].join('.')
        });
    }

    async decrypt(value: EncryptionString, options: BaseDecryptOptions<RemoteKeyHandle>): Promise<string> {
        const key: Buffer = await this.resolve(options.key);
        const content: EncryptionContent = EncryptionUtilities.encryptionStringToContent(value);
        const [ivB64, tagB64, contentB64] = content.encryptedValue.split('.');
        if (ivB64 == undefined || tagB64 == undefined || contentB64 == undefined) {
            throw new Error('not a value this strategy wrote');
        }

        const decipher: DecipherGCM = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
        decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
        return Buffer.concat([
            decipher.update(Buffer.from(contentB64, 'base64')),
            decipher.final()
        ]).toString('utf8');
    }

    // a master strategy wraps data keys, which belong to no row
    isBoundToRow(): boolean {
        return false;
    }

    generateRandomKey(): RemoteKeyHandle {
        const keyRef: string = `${remoteMasterKeyRef}/${UUIDUtilities.generate()}`;
        remoteKeyStore.set(keyRef, randomBytes(32));
        return { keyRef };
    }

    serializeKey(key: RemoteKeyHandle): Buffer {
        return Buffer.from(key.keyRef, 'utf8');
    }

    deserializeKey(raw: Buffer): RemoteKeyHandle {
        return { keyRef: raw.toString('utf8') };
    }

    /**
     * The one place key material exists, standing in for a call to the remote service.
     * @param handle - The reference the application was configured with.
     * @returns The key the reference names.
     * @throws When the remote store does not know the reference.
     */
    private async resolve(handle: RemoteKeyHandle): Promise<Buffer> {
        const key: Buffer | undefined = remoteKeyStore.get(handle.keyRef);
        if (!key) {
            throw new Error(`no key behind "${handle.keyRef}"`);
        }
        return await Promise.resolve(key);
    }
}

describe('EncryptionService - a master key that lives outside the process', () => {
    it('starts, rewraps and reads with a master strategy that is only ever given a key handle', async () => {
        const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
            entities: defaultTestServerEntities,
            repositories: defaultTestServerRepositories
        });
        const first: StartedTestServer = await startTestServer({ dataSources: [dataSourceClass] });
        // written under the aes-gcm master, before the application has any notion of a remote one
        const before: OtpCredentials = await inject<Repository<OtpCredentials>>(repositoryTokenFor(OtpCredentials))
            .create({ userId: UUIDUtilities.generate(), secret: 'kms-seed' });
        await first.shutdown();

        const second: StartedTestServer = await startTestServer({
            dataSources: [dataSourceClass],
            providers: [
                ...defaultTestServerProviders.filter(p => p.token !== ZIBRI_DI_TOKENS.ENCRYPTION_MASTER_OPTIONS),
                defineProvider({
                    token: ZIBRI_DI_TOKENS.ENCRYPTION_MASTER_OPTIONS,
                    useValue: {
                        currentMasterStrategy: new RemoteMasterStrategy(),
                        currentMasterKey: { id: 'remote-mk1', value: { keyRef: remoteMasterKeyRef } },
                        // what the application used a moment ago. Without it the key rows already
                        // stored are unreadable, which is true of any change of master
                        oldMasterStrategies: [new AesGcmEncryptionStrategy()],
                        oldMasterKeys: [testMasterKey]
                    }
                })
            ]
        });
        try {
            // the framework was handed a reference and nothing else. Whether that reference resolves
            // to bytes is the strategy's business, and this one keeps them where the application
            // cannot reach
            const masterOptions: EncryptionMasterOptions<RemoteKeyHandle> | undefined = inject(ZIBRI_DI_TOKENS.ENCRYPTION_MASTER_OPTIONS);
            expect(masterOptions?.currentMasterKey.value).toEqual({ keyRef: remoteMasterKeyRef });

            // every data key was rewrapped under the remote master while starting, which is the part
            // that has to work before any of the rest can
            const keys: EncryptionKey[] = await inject<Repository<EncryptionKey>>(repositoryTokenFor(EncryptionKey)).findAll({});
            expect(keys.length).toBeGreaterThan(0);
            expect(keys.every(k => k.value.startsWith('remote-kms.v1.'))).toBe(true);

            const credentials: Repository<OtpCredentials> = inject(repositoryTokenFor(OtpCredentials));
            // a value written before the change still reads, so unwrapping went through the handle
            await expect(credentials.findById(before.id)).resolves.toMatchObject({ secret: 'kms-seed' });

            // and a new one round trips, so wrapping did too
            const after: OtpCredentials = await credentials.create({ userId: UUIDUtilities.generate(), secret: 'kms-seed-2' });
            await expect(credentials.findById(after.id)).resolves.toMatchObject({ secret: 'kms-seed-2' });
        }
        finally {
            await second.shutdown();
        }
    }, TestTimeouts.inMemory.start * 2);
});