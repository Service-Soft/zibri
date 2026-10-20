import assert from 'node:assert';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, MockInstance } from 'vitest';
import { createInMemoryDataSource } from 'zibri-testing';

import { EncryptionKey, EncryptionKeyStatus } from './encryption-key.model.ts';
import { EncryptionRotationFailure } from './encryption-rotation-failure.model.ts';
import { EncryptionRotationProgress } from './encryption-rotation-progress.model.ts';
import { EncryptionRotationCronJob } from './encryption-rotation.cron-job.ts';
import { type EncryptionServiceInterface } from './encryption-service.interface.ts';
import { EncryptionString } from './encryption.utilities.ts';
import { RetiredKeyUsage } from './retired-key-usage.model.ts';
import { AesGcmEncryptionStrategy } from './strategies/aes-gcm.encryption-strategy.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { Ms } from '../../utilities/ms.ts';
import { UUIDUtilities } from '../../utilities/uuid.utilities.ts';
import { OtpCredentials } from '../2fa/methods/otp/otp-credentials.model.ts';

describe('EncryptionRotationCronJob', () => {
    let server: StartedTestServer;
    let encryptionService: EncryptionServiceInterface;
    let otpRepository: Repository<OtpCredentials>;
    let failureRepository: Repository<EncryptionRotationFailure>;

    beforeAll(async () => {
        server = await startTestServer({ dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities })] });
        encryptionService = inject(ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE);
        otpRepository = inject(repositoryTokenFor(OtpCredentials));
        failureRepository = inject(repositoryTokenFor(EncryptionRotationFailure));
    }, 20000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    beforeEach(async () => {
        // through the driver, because a broken row is one the repository refuses to read - and reading
        // is what deleting through it starts with
        const raw: Repository<OtpCredentials>['driver'] = otpRepository['driver'];
        await raw.remove(await raw.findIds({}), undefined);
        await failureRepository.deleteAll({});
        await inject(repositoryTokenFor(EncryptionRotationProgress)).deleteAll({});
    });

    /**
     * Builds the job the way the cron service does, as a freshly started instance would have it.
     * @returns The job, with `onTick` callable on demand.
     */
    function startJob(): EncryptionRotationCronJob {
        const job: EncryptionRotationCronJob = new EncryptionRotationCronJob(encryptionService);
        // set by the cron service when it initializes the job, which the test server does not run
        job['logger'] = inject(ZIBRI_DI_TOKENS.LOGGER);
        job.onAppInit(server['app']);
        return job;
    }

    /**
     * Creates credentials with the given secret.
     * @param secret - The secret.
     * @returns The credentials.
     */
    async function createCredentials(secret: string): Promise<OtpCredentials> {
        return await otpRepository.create({ userId: UUIDUtilities.generate(), secret });
    }

    /**
     * The secret of a row as it is stored.
     * @param id - The id of the row.
     * @returns The envelope, `<strategy>.<version>.<keyId>.<binding>...`.
     */
    async function findStoredSecret(id: string): Promise<string> {
        return (await otpRepository.findById(id, { autoDecrypt: false })).secret;
    }

    /**
     * The data key the secret of a row is encrypted with.
     * @param id - The id of the row.
     * @returns The id of the key.
     */
    async function findStoredKeyId(id: string): Promise<string> {
        const keyId: string | undefined = (await findStoredSecret(id)).split('.')[2];
        assert(keyId, 'the stored secret carries no key id');
        return keyId;
    }

    /**
     * Retires a key the way the documentation does: a new default first, then the old one deprecated.
     * @param keyId - The key to retire.
     */
    async function retireKey(keyId: string): Promise<void> {
        const replacement: EncryptionKey = await encryptionService.createKey(AesGcmEncryptionStrategy, { status: EncryptionKeyStatus.ACTIVE });
        await encryptionService.markKeyAsDefaultForStrategy(replacement.id, AesGcmEncryptionStrategy);
        await encryptionService.deprecateKey(keyId);
    }

    /**
     * Copies the stored secret of one row into others, which cannot decrypt it: it is bound to its row.
     * What a write primitive on the database does, an import that trusts its input for one.
     * @param source - The row whose secret is copied.
     * @param targets - The rows it is copied into.
     */
    async function breakRows(source: OtpCredentials, targets: OtpCredentials[]): Promise<void> {
        const secret: string = await findStoredSecret(source.id);
        await otpRepository['driver'].save(targets.map(target => ({ ...target, secret })), undefined, false);
    }

    /**
     * Stores the secret of a row the way a version of the framework before row binding wrote it.
     * @param row - The row.
     */
    async function writeUnbound(row: OtpCredentials): Promise<void> {
        const legacy: EncryptionString = await encryptionService.encrypt(row.secret);
        await otpRepository['driver'].save([{ ...row, secret: legacy }], undefined, false);
    }

    /**
     * Whether the secret of a row is bound to it.
     * @param id - The id of the row.
     * @returns Whether it is.
     */
    async function isBound(id: string): Promise<boolean> {
        return (await findStoredSecret(id)).split('.')[3] === 'b';
    }

    it('gets past rows it cannot rewrite, however many of them come first', async () => {
        // copies of one row's secret, which no other row can decrypt. Stored first and with ids that sort
        // first, so they come first whichever order the store reads in
        const source: OtpCredentials = await otpRepository.findById((await createCredentials('source')).id, { autoDecrypt: false });
        await otpRepository['driver'].save(
            Array.from({ length: 1000 }, (_, i) => ({
                ...source,
                id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
                userId: UUIDUtilities.generate()
            })),
            undefined,
            false
        );
        const healthy: OtpCredentials = await createCredentials('healthy');
        const keyId: string = await findStoredKeyId(healthy.id);
        await retireKey(keyId);

        // more stuck rows than two runs may write. Each run used to start from the first row again and
        // spend all of its budget on the same rows that fail every time
        const job: EncryptionRotationCronJob = startJob();
        // each stuck row is said once, which is a thousand errors nobody here reads
        const quiet: MockInstance<typeof job['logger']['error']> = vi.spyOn(job['logger'], 'error').mockImplementation(() => undefined);
        await job.onTick();
        await job.onTick();
        await job.onTick();
        // the logger is the application's, which the other cases watch
        quiet.mockRestore();

        expect(await findStoredKeyId(healthy.id)).not.toBe(keyId);
        await expect(otpRepository.findById(healthy.id)).resolves.toMatchObject({ secret: 'healthy' });
    }, 60000);

    it('records a row it cannot rewrite, says so once, tries again later and reports it under its key', async () => {
        const source: OtpCredentials = await createCredentials('source');
        const broken: OtpCredentials = await createCredentials('broken');
        const original: OtpCredentials = await otpRepository.findById(broken.id, { autoDecrypt: false });
        await breakRows(source, [broken]);
        const keyId: string = await findStoredKeyId(broken.id);
        await retireKey(keyId);
        const job: EncryptionRotationCronJob = startJob();
        const logged: MockInstance<typeof job['logger']['error']> = vi.spyOn(job['logger'], 'error');

        await job.onTick();

        const [failure, ...others] = await failureRepository.findAll({});
        assert(failure, 'nothing recorded the row');
        expect(others).toHaveLength(0);
        expect(failure).toMatchObject({ entityName: OtpCredentials.name, rowId: broken.id, keyIds: [keyId], attempts: 1 });
        expect(logged).toHaveBeenCalledTimes(1);
        const usage: RetiredKeyUsage = await encryptionService.resolveRetiredKeyUsage();
        expect(usage.dataKeys.find(k => k.keyId === keyId)?.stuckRows).toEqual([expect.objectContaining({ rowId: broken.id })]);

        // not due yet: left alone, and not said again
        await job.onTick();
        expect((await failureRepository.findById(failure.id)).attempts).toBe(1);

        // due: tried again, and the wait doubles
        await failureRepository.updateById(failure.id, { retryAt: new Date(Date.now() - 1000) });
        await job.onTick();
        const retried: EncryptionRotationFailure = await failureRepository.findById(failure.id);
        expect(retried.attempts).toBe(2);
        expect(new Date(retried.retryAt).getTime()).toBeGreaterThan(Date.now() + (1.5 * Ms.HOUR));
        expect(logged).toHaveBeenCalledTimes(1);

        // repaired: the next attempt rewrites it, and the record goes
        await otpRepository['driver'].save([original], undefined, false);
        await failureRepository.updateById(failure.id, { retryAt: new Date(Date.now() - 1000) });
        await job.onTick();
        expect(await failureRepository.findAll({})).toHaveLength(0);
        expect(await findStoredKeyId(broken.id)).not.toBe(keyId);
        await expect(otpRepository.findById(broken.id)).resolves.toMatchObject({ secret: 'broken' });
    }, 20000);

    it('drops the record of a row that no longer exists', async () => {
        const source: OtpCredentials = await createCredentials('source');
        const broken: OtpCredentials = await createCredentials('broken');
        await breakRows(source, [broken]);
        await retireKey(await findStoredKeyId(broken.id));
        const job: EncryptionRotationCronJob = startJob();
        await job.onTick();
        const [failure] = await failureRepository.findAll({});
        assert(failure, 'nothing recorded the row');

        await otpRepository['driver'].remove([broken.id], undefined);
        await failureRepository.updateById(failure.id, { retryAt: new Date(Date.now() - 1000) });
        await job.onTick();

        expect(await failureRepository.findAll({})).toHaveLength(0);
    }, 20000);

    it('reads the stored values again only after a start, or once another key is retired', async () => {
        const job: EncryptionRotationCronJob = startJob();
        // the pass every instance makes once it started
        await job.onTick();

        const first: OtpCredentials = await createCredentials('first');
        await writeUnbound(first);
        await job.onTick();
        // nothing was retired since that pass, so nothing was read
        expect(await isBound(first.id)).toBe(false);

        // an instance that just started makes its own pass, which is what binds the values of a
        // database an older version wrote
        await startJob().onTick();
        expect(await isBound(first.id)).toBe(true);

        const second: OtpCredentials = await createCredentials('second');
        await writeUnbound(second);
        await job.onTick();
        expect(await isBound(second.id)).toBe(false);

        await retireKey(await findStoredKeyId(second.id));
        await job.onTick();
        expect(await isBound(second.id)).toBe(true);
        await expect(otpRepository.findById(second.id)).resolves.toMatchObject({ secret: 'second' });
    }, 20000);
});