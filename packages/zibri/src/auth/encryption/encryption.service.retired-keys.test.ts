import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createInMemoryDataSource, testMasterKey } from 'zibri-testing';

import { EncryptionKey, EncryptionKeyCreateData, EncryptionKeyStatus } from './encryption-key.model.ts';
import { EncryptionMasterKey } from './encryption-master-options.model.ts';
import { EncryptionRotationCronJob } from './encryption-rotation.cron-job.ts';
import { EncryptionServiceInterface } from './encryption-service.interface.ts';
import { EncryptionString } from './encryption.utilities.ts';
import { RetiredKeyUsage } from './retired-key-usage.model.ts';
import { AesGcmEncryptionStrategy } from './strategies/aes-gcm.encryption-strategy.ts';
import { testFileFolder } from '../../__testing__/constants.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { BackupEntity } from '../../backup/backup-entity.model.ts';
import { BackupResourceEntity } from '../../backup/backup-resource-entity.model.ts';
import { BackupResourceInterface } from '../../backup/backup-resource.interface.ts';
import { Backup } from '../../backup/decorators/backup-resource.decorator.ts';
import { BackupTransport } from '../../backup/decorators/backup-transport.decorator.ts';
import { BaseFsBackupTransport } from '../../backup/transports/fs.backup-transport.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { defineProvider } from '../../di/models/di-provider.model.ts';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities.ts';
import { UUIDUtilities } from '../../utilities/uuid.utilities.ts';
import { OtpCredentials } from '../2fa/methods/otp/otp-credentials.model.ts';

const backupFolder: FsPath = FsUtilities.getPath(testFileFolder, 'backups-retired-keys');

@BackupTransport()
class RetiredKeysFsBackupTransport extends BaseFsBackupTransport {
    override readonly name: string = 'retired-keys-fs-backup-transport';
    protected override readonly backupBasePath: FsPath = backupFolder;
}

/**
 * A resource backed up on its own, without the data source the data keys are stored in.
 */
@Backup({ transports: [RetiredKeysFsBackupTransport], encrypt: false })
class SettingsStore implements BackupResourceInterface {
    createBackupData(): Readable {
        return Readable.from([Buffer.from('settings')]);
    }

    async restoreBackup(): Promise<void> {
        // nothing in this suite restores it
    }

    validateBackupConfiguration(): void {
        // holds everything it needs
    }
}

const replacementMasterKey: EncryptionMasterKey<Buffer> = {
    id: 'mk2',
    value: createHash('sha256').update('zibri-test-replacement-master-key')
        .digest()
};

function getEncryptionService(): EncryptionServiceInterface {
    return inject(ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE);
}

function getOtpRepository(): Repository<OtpCredentials> {
    return inject(repositoryTokenFor(OtpCredentials));
}

describe('EncryptionService — what is still under a retired key', () => {
    let server: StartedTestServer | undefined;
    let retiredDataKeyId: string | undefined;

    beforeAll(async () => {
        await FsUtilities.rm(backupFolder);
        server = await startTestServer({
            dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, BackupEntity, BackupResourceEntity] })]
        });
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 30000);

    test('reports nothing while nothing is being retired', async () => {
        await getOtpRepository().create({ userId: UUIDUtilities.generate(), secret: 'seed' });

        const nothing: RetiredKeyUsage = { dataKeys: [], masterKeys: [], masterStrategies: [] };
        expect(await getEncryptionService().resolveRetiredKeyUsage()).toEqual(nothing);

        await getOtpRepository().deleteAll({});
    });

    test('counts the values of a deprecated key until the sweep has rewritten them', async () => {
        assert(server, 'the server did not start');
        const encryptionService: EncryptionServiceInterface = getEncryptionService();
        await getOtpRepository().createAll([
            { userId: UUIDUtilities.generate(), secret: 'one' },
            { userId: UUIDUtilities.generate(), secret: 'two' }
        ]);
        const [stored]: OtpCredentials[] = await getOtpRepository().findAll({ autoDecrypt: false });
        const retiredKeyId: string | undefined = stored?.secret.split('.')[2];
        assert(retiredKeyId, 'the stored secret carries no key id');
        const replacement: EncryptionKey = await encryptionService.createKey(AesGcmEncryptionStrategy, { status: EncryptionKeyStatus.ACTIVE });
        await encryptionService.markKeyAsDefaultForStrategy(replacement.id, AesGcmEncryptionStrategy);
        await encryptionService.deprecateKey(retiredKeyId);
        // written after the deprecation, under the new default, so it is not counted
        await getOtpRepository().create({ userId: UUIDUtilities.generate(), secret: 'three' });

        expect((await encryptionService.resolveRetiredKeyUsage()).dataKeys).toEqual([{ keyId: retiredKeyId, strategyName: 'aes-256-gcm', strategyVersion: 'v1', values: 2, backups: 0, stuckRows: [] }]);

        // the test server runs no cron jobs, so the sweep is built and run the way the cron service would
        const rotationJob: EncryptionRotationCronJob = new EncryptionRotationCronJob(encryptionService);
        rotationJob.onAppInit(server['app']);
        await rotationJob.onTick();

        expect((await encryptionService.resolveRetiredKeyUsage()).dataKeys).toEqual([{ keyId: retiredKeyId, strategyName: 'aes-256-gcm', strategyVersion: 'v1', values: 0, backups: 0, stuckRows: [] }]);

        await getOtpRepository().deleteAll({});
        retiredDataKeyId = retiredKeyId;
    }, 20000);

    test('counts a backup that does not hold the data keys towards every data key it was taken with', async () => {
        assert(retiredDataKeyId, 'the previous test retired no key');
        // the settings are backed up and the data source holding the key table is not, so restoring
        // them needs the data keys to still be there
        await inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE).createBackup({ name: 'without-the-key-table' });
        const [backup]: BackupEntity[] = await inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE).resolveRecordedBackups();
        expect(backup?.resources.map(r => r.name)).toEqual([SettingsStore.name]);
        expect(backup?.dataKeyIds).toContain(retiredDataKeyId);

        expect((await getEncryptionService().resolveRetiredKeyUsage()).dataKeys).toEqual([{ keyId: retiredDataKeyId, strategyName: 'aes-256-gcm', strategyVersion: 'v1', values: 0, backups: 1, stuckRows: [] }]);
    }, 20000);

    test('counts the data keys still under an old master key', async () => {
        assert(server, 'the server did not start');
        // what an instance that has not been given the new master key yet writes during a rolling
        // deploy: a key wrapped under the old one, after this instance re-wrapped the others
        const underOldMaster: EncryptionString = await getEncryptionService().masterEncrypt(Buffer.alloc(32, 1).toString('base64'));
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
        const keyRepository: Repository<EncryptionKey, EncryptionKeyCreateData> = inject(repositoryTokenFor(EncryptionKey));

        // every key there was is re-wrapped while the application starts
        expect((await getEncryptionService().resolveRetiredKeyUsage()).masterKeys).toEqual([{ keyId: testMasterKey.id, dataKeys: 0, backups: 0 }]);

        const [anyKey]: EncryptionKey[] = await keyRepository.findAll({ relations: ['strategy'] });
        assert(anyKey, 'there is no key to copy the strategy of');
        await keyRepository.create({ value: underOldMaster, strategy: anyKey.strategy, status: EncryptionKeyStatus.ACTIVE });

        expect((await getEncryptionService().resolveRetiredKeyUsage()).masterKeys).toEqual([{ keyId: testMasterKey.id, dataKeys: 1, backups: 0 }]);
    }, 30000);
});