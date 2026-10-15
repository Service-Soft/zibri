import assert from 'node:assert';

import { afterAll, beforeAll, describe, expect, jest, test } from '@jest/globals';

import { EncryptionKey, EncryptionKeyStatus } from './encryption-key.model';
import { EncryptionRotationCronJob } from './encryption-rotation.cron-job';
import { EncryptionService } from './encryption.service';
import { EncryptionString } from './encryption.utilities';
import { AesGcmEncryptionStrategy } from './strategies/aes-gcm.encryption-strategy';
import { EncryptionStrategyEntity } from './strategies/encryption-strategy-entity.model';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { startAndStopTestServerWithout } from '../../__testing__/test-server/start-and-stop-test-server-without.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { OtpCredentials } from '../2fa/methods/otp/otp-credentials.model';

// first, for the reason on startAndStopTestServerWithout
describe('EncryptionService — starting', () => {
    test('refuses to start without its entities, and names both', async () => {
        const start: Promise<void> = startAndStopTestServerWithout([EncryptionKey, EncryptionStrategyEntity]);

        await expect(start).rejects.toThrow('Error initializing EncryptionService');
        await expect(start).rejects.toThrow(/EncryptionStrategyEntity[\S\s]*EncryptionKey/);
    }, 30000);

    test('refuses to start without the master key options, whether or not anything is encrypted', async () => {
        const start: Promise<void> = startAndStopTestServerWithout([], {
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.ENCRYPTION_MASTER_OPTIONS, useValue: undefined })
            ]
        });

        await expect(start).rejects.toThrow('No provider for token "zi.encryption_master_options"');
    }, 30000);
});

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

    describe('binding a value to its row', () => {
        test('refuses a value that was written for a different row', async () => {
            const encrypted: EncryptionString = await encryptionService.encrypt(
                'secret',
                { strategyOptions: { binding: { rowId: 'row-a' } } }
            );

            // this is the whole finding: everything needed to decrypt lives in the stored value, so
            // without the binding a value copied into another row is served to whoever owns that row
            await expect(encryptionService.decrypt(encrypted, { binding: { rowId: 'row-b' } })).rejects.toThrow();
            await expect(encryptionService.decrypt(encrypted, { binding: { rowId: 'row-a' } })).resolves.toBe('secret');
        });

        test('refuses a bound value that is read without saying which row', async () => {
            const encrypted: EncryptionString = await encryptionService.encrypt(
                'secret',
                { strategyOptions: { binding: { rowId: 'row-a' } } }
            );

            await expect(encryptionService.decrypt(encrypted)).rejects.toThrow();
        });

        test('refuses a value whose binding marker was edited', async () => {
            const encrypted: EncryptionString = await encryptionService.encrypt(
                'secret',
                { strategyOptions: { binding: { rowId: 'row-a' } } }
            );
            const [name, version, keyId, marker, ...rest] = encrypted.split('.');
            expect(marker).toBe('b');

            // downgrading the marker asks for the weaker aad, which is exactly what an attacker
            // holding a write would try. It is inside the tag, so it does not survive
            const downgraded: EncryptionString = [name, version, keyId, 'u', ...rest].join('.') as EncryptionString;
            await expect(encryptionService.decrypt(downgraded, { binding: { rowId: 'row-a' } })).rejects.toThrow();

            // and so is removing it altogether, which asks for the format that authenticates nothing
            const stripped: EncryptionString = [name, version, keyId, ...rest].join('.') as EncryptionString;
            await expect(encryptionService.decrypt(stripped, { binding: { rowId: 'row-a' } })).rejects.toThrow();
        });

        test('still reads a value written before binding existed', async () => {
            // no binding is what a value stored by an older version of the framework looks like, and
            // what the service still writes for anything that is not a row of an entity
            const legacy: EncryptionString = await encryptionService.encrypt('secret');

            await expect(encryptionService.decrypt(legacy)).resolves.toBe('secret');
            await expect(encryptionService.decrypt(legacy, { binding: { rowId: 'row-a' } })).resolves.toBe('secret');
        });

        test('a value bound to nothing but its header moves between rows', async () => {
            const encrypted: EncryptionString = await encryptionService.encrypt(
                'secret',
                { strategyOptions: { binding: { rowId: undefined } } }
            );

            // what `bindToRow: false` buys back, and what it gives up
            expect(encrypted.split('.')[3]).toBe('u');
            await expect(encryptionService.decrypt(encrypted, { binding: { rowId: 'row-b' } })).resolves.toBe('secret');
        });

        test('hands back the stored envelope when autoDecrypt is off', async () => {
            const otpRepository: Repository<OtpCredentials> = inject(repositoryTokenFor(OtpCredentials));
            const created: OtpCredentials = await otpRepository.create({ userId: UUIDUtilities.generate(), secret: 'seed' });

            const asStored: OtpCredentials = await otpRepository.findById(created.id, { autoDecrypt: false });
            const asValue: OtpCredentials = await otpRepository.findById(created.id);

            // which strategy and key a value was written with, and whether it is bound, only exist
            // before decryption - so anything asking how a value is stored has to ask for this
            expect(asStored.secret.split('.').slice(0, 2)).toEqual(['aes-256-gcm', 'v1']);
            expect(asStored.secret.split('.')[3]).toBe('b');
            expect(asValue.secret).toBe('seed');

            await otpRepository.deleteAll({});
        });

        test('refuses an encrypted column that was copied into another row', async () => {
            const otpRepository: Repository<OtpCredentials> = inject(repositoryTokenFor(OtpCredentials));
            const victim: OtpCredentials = await otpRepository.create({ userId: UUIDUtilities.generate(), secret: 'victim-seed' });
            const attacker: OtpCredentials = await otpRepository.create({ userId: UUIDUtilities.generate(), secret: 'attacker-seed' });

            // what a write primitive on the database gets you - a sql injection, an over permissive
            // admin screen, an import that trusts its input. The value is moved exactly as stored,
            // which is why nothing about the application noticing it depends on the application
            const raw: Repository<OtpCredentials>['driver'] = otpRepository['driver'];
            const stored: OtpCredentials[] = await raw.find({});
            const victimRow: OtpCredentials | undefined = stored.find(c => c.id === victim.id);
            assert(victimRow);
            await raw.save([{ id: attacker.id, secret: victimRow.secret }] as OtpCredentials[], undefined, false);

            await expect(otpRepository.findById(attacker.id)).rejects.toThrow();
            // and the row nobody touched is unaffected
            await expect(otpRepository.findById(victim.id)).resolves.toMatchObject({ secret: 'victim-seed' });

            // through the driver, because the tampered row is precisely one the repository refuses to
            // read - and reading is what deleting through it starts with
            await raw.remove(await raw.find({}), undefined);
        });

        test('writes a distinct value per row when a bound property is updated in bulk', async () => {
            const otpRepository: Repository<OtpCredentials> = inject(repositoryTokenFor(OtpCredentials));
            const first: OtpCredentials = await otpRepository.create({ userId: UUIDUtilities.generate(), secret: 'one' });
            const second: OtpCredentials = await otpRepository.create({ userId: UUIDUtilities.generate(), secret: 'two' });

            await otpRepository.updateAll({ confirmed: false }, { secret: 'rotated' });

            // one call, but not one ciphertext: each row's value is encrypted for that row, which is
            // what makes them unable to trade places afterwards
            const raw: Repository<OtpCredentials>['driver'] = otpRepository['driver'];
            const stored: OtpCredentials[] = await raw.find({});
            expect(stored[0]?.secret).not.toBe(stored[1]?.secret);

            await expect(otpRepository.findById(first.id)).resolves.toMatchObject({ secret: 'rotated' });
            await expect(otpRepository.findById(second.id)).resolves.toMatchObject({ secret: 'rotated' });

            await raw.remove(await raw.find({}), undefined);
        });
    });

    describe('rotating what is already stored', () => {
        let rotationJob: EncryptionRotationCronJob;

        beforeAll(() => {
            // the test server runs no cron jobs, so nothing registered this one. Built the way the
            // cron service builds it, which is also what makes onTick callable on demand rather than
            // on the hour
            rotationJob = new EncryptionRotationCronJob(encryptionService);
            rotationJob.onAppInit(server['app']);
        });

        test('rewrites a value under a deprecated key, and leaves the rest alone', async () => {
            const otpRepository: Repository<OtpCredentials> = inject(repositoryTokenFor(OtpCredentials));
            const stale: OtpCredentials = await otpRepository.create({ userId: UUIDUtilities.generate(), secret: 'stale-seed' });

            // `<iv>.<ciphertext>.<keyId>`, so the third part is the key the row was written with
            const originalKeyId: string | undefined = (await otpRepository.findById(stale.id, { autoDecrypt: false }))
                .secret.split('.')[2];
            assert(originalKeyId, 'the stored secret carries no key id');
            const replacement: EncryptionKey = await encryptionService.createKey(AesGcmEncryptionStrategy, {
                status: EncryptionKeyStatus.ACTIVE
            });
            await encryptionService.markKeyAsDefaultForStrategy(replacement.id, AesGcmEncryptionStrategy);
            await encryptionService.deprecateKey(originalKeyId);

            // written after the deprecation, so it already uses the new default key
            const fresh: OtpCredentials = await otpRepository.create({ userId: UUIDUtilities.generate(), secret: 'fresh-seed' });
            const freshBefore: string = (await otpRepository.findById(fresh.id, { autoDecrypt: false })).secret;

            await rotationJob.onTick();

            const staleAfter: OtpCredentials = await otpRepository.findById(stale.id, { autoDecrypt: false });
            expect(staleAfter.secret.split('.')[2]).not.toBe(originalKeyId);
            // and the value survived being rewritten, which is the part that matters
            await expect(otpRepository.findById(stale.id)).resolves.toMatchObject({ secret: 'stale-seed' });

            // nothing was wrong with this one, so nothing touched it
            expect((await otpRepository.findById(fresh.id, { autoDecrypt: false })).secret).toBe(freshBefore);

            await otpRepository.deleteAll({});
        }, 20000);

        test('binds a value that was stored before binding existed', async () => {
            const otpRepository: Repository<OtpCredentials> = inject(repositoryTokenFor(OtpCredentials));
            const created: OtpCredentials = await otpRepository.create({ userId: UUIDUtilities.generate(), secret: 'legacy-seed' });

            // what a row written by an older version of the framework looks like: same key, same
            // strategy, no binding at all - so nothing about the key tells the sweep to look at it
            const legacy: EncryptionString = await encryptionService.encrypt('legacy-seed');
            const raw: Repository<OtpCredentials>['driver'] = otpRepository['driver'];
            await raw.save([{ ...created, secret: legacy }], undefined, false);
            expect((await otpRepository.findById(created.id, { autoDecrypt: false })).secret.split('.').length).toBe(6);

            await rotationJob.onTick();

            const after: OtpCredentials = await otpRepository.findById(created.id, { autoDecrypt: false });
            expect(after.secret.split('.')[3]).toBe('b');
            await expect(otpRepository.findById(created.id)).resolves.toMatchObject({ secret: 'legacy-seed' });

            await otpRepository.deleteAll({});
        }, 20000);
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