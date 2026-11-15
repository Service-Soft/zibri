import assert from 'node:assert';

import { beforeEach, describe, expect, it } from '@jest/globals';

import { BackupEntity } from './backup-entity.model';
import { BackupServiceInterface } from './backup-service.interface';
import { RestoreJournalUtilities } from './restore-journal.utilities';
import { StartedTestServer } from '../__testing__/test-server/start-test-server.function';
import { EncryptionKey, EncryptionKeyStatus } from '../auth/encryption/encryption-key.model';
import { type EncryptionServiceInterface } from '../auth/encryption/encryption-service.interface';
import { KeptEncryptionKeys } from '../auth/encryption/kept-encryption-keys.model';
import { SigningKey } from '../auth/encryption/signing-key.model';
import { AesGcmEncryptionStrategy } from '../auth/encryption/strategies/aes-gcm.encryption-strategy';
import { EncryptionStrategyEntity } from '../auth/encryption/strategies/encryption-strategy-entity.model';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { UUIDUtilities } from '../utilities/uuid.utilities';

const SERVER_NOT_STARTED: string = 'the server did not start';
const WRITTEN_AFTER_RESTORE_TEXT: string = 'written after the restore';

/**
 * A value encrypted with the default key, which a data source running the cases declares beside the
 * entities of the keys.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
export class RestoredSecret extends BaseEntity {
    @Property.string({ encryption: true })
    text!: string;
}

function getSecrets(): Repository<RestoredSecret> {
    return inject(repositoryTokenFor(RestoredSecret));
}

function getBackupService(): BackupServiceInterface {
    return inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE);
}

function getEncryptionService(): EncryptionServiceInterface {
    return inject(ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE);
}

async function takeBackup(): Promise<BackupEntity> {
    return await getBackupService().waitForBackup(await getBackupService().queueBackup({ name: `keys-${UUIDUtilities.generate()}` }));
}

/**
 * The texts of every secret, decrypted.
 * @returns The texts, sorted.
 */
async function findTexts(): Promise<string[]> {
    return (await getSecrets().findAll()).map(s => s.text).sort();
}

/**
 * The keys values are encrypted with, across a restore of the data source holding them: what is written
 * after the restore is encrypted with the key the application holds, which the restore keeps.
 * @param name - The data source, in the name of the suite.
 * @param getServer - The server, booted with one data source marked with `@Backup` holding the keys and
 * {@link RestoredSecret}.
 */
export function describeKeysAcrossRestore(name: string, getServer: () => StartedTestServer | undefined): void {
    describe(`BackupService - the keys of encrypted values across a restore, on ${name}`, () => {
        beforeEach(async () => {
            await getSecrets().deleteAll({});
        });

        it('keeps a key made after the backup, which values written after the restore are encrypted with', async () => {
            const server: StartedTestServer | undefined = getServer();
            assert(server, SERVER_NOT_STARTED);
            await getSecrets().create({ text: 'backed up' });
            const backup: BackupEntity = await takeBackup();
            // a rotation after the backup: the key the application encrypts with from now on is one the backup lacks
            const rotated: EncryptionKey = await getEncryptionService().createKey(
                AesGcmEncryptionStrategy,
                { status: EncryptionKeyStatus.DEFAULT }
            );

            await getBackupService().restore(backup);
            await getSecrets().create({ text: WRITTEN_AFTER_RESTORE_TEXT });
            // a restart reads the keys again from what is stored
            await server.reInit();

            expect(await findTexts()).toEqual(['backed up', WRITTEN_AFTER_RESTORE_TEXT]);
            const defaults: EncryptionKey[] = await inject(repositoryTokenFor(EncryptionKey))
                .findAll({ where: { status: EncryptionKeyStatus.DEFAULT } });
            expect(defaults.map(k => k.id)).toEqual([rotated.id]);
        }, 60000);

        it('writes back at the next start the keys a restore that was killed may not have written back', async () => {
            const server: StartedTestServer | undefined = getServer();
            assert(server, SERVER_NOT_STARTED);
            await getSecrets().create({ text: 'backed up' });
            const rotated: EncryptionKey = await getEncryptionService().createKey(
                AesGcmEncryptionStrategy,
                { status: EncryptionKeyStatus.DEFAULT }
            );
            await getSecrets().create({ text: 'under the rotated key' });
            const kept: KeptEncryptionKeys | undefined = await getEncryptionService().resolveKeptKeys?.();
            assert(kept, 'the encryption service keeps no keys');
            // what a process killed once the data source was replaced, and before the keys were written back,
            // leaves: a journal holding the keys, and a data source holding those of the backup
            await RestoreJournalUtilities.write(
                RestoreJournalUtilities.getPath(inject(ZIBRI_DI_TOKENS.BACKUP_TEMP_FOLDER), UUIDUtilities.generate()),
                {
                    backupName: 'killed before the keys were written back',
                    applied: [],
                    keptEncryptionKeys: kept
                }
            );
            await inject(repositoryTokenFor(EncryptionKey)).removeAsStored({ id: rotated.id }, undefined);

            await server.reInit();

            expect(await findTexts()).toEqual(['backed up', 'under the rotated key']);
            expect(await RestoreJournalUtilities.findPaths(inject(ZIBRI_DI_TOKENS.BACKUP_TEMP_FOLDER))).toEqual([]);
        }, 60000);

        it('keeps the keys of a database the application made them in, restored onto with a backup of another one', async () => {
            const server: StartedTestServer | undefined = getServer();
            assert(server, SERVER_NOT_STARTED);
            await getSecrets().create({ text: 'backed up' });
            const backup: BackupEntity = await takeBackup();
            // what a fresh database holds once the application started on it: keys of its own, under rows of
            // the strategies of its own
            await inject(repositoryTokenFor(EncryptionKey)).deleteAll({});
            await inject(repositoryTokenFor(EncryptionStrategyEntity)).deleteAll({});
            await inject(repositoryTokenFor(SigningKey)).deleteAll({});
            await getSecrets().deleteAll({});
            await server.reInit();
            await getSecrets().create({ text: 'on the fresh database' });

            await getBackupService().restore(backup);
            await getSecrets().create({ text: WRITTEN_AFTER_RESTORE_TEXT });
            await server.reInit();

            expect(await findTexts()).toEqual(['backed up', WRITTEN_AFTER_RESTORE_TEXT]);
            // the row of the strategy the application held, which the keys of the backup went under
            const strategies: EncryptionStrategyEntity[] = await inject(repositoryTokenFor(EncryptionStrategyEntity))
                .findAll({ limit: 'all' });
            expect(strategies.filter(s => s.name === new AesGcmEncryptionStrategy().name)).toHaveLength(1);
        }, 60000);
    });
}