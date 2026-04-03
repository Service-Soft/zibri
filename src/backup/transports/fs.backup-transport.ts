import { Dirent } from 'node:fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

import { BackupTransportInterface } from './backup-transport.interface';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { LoggerInterface } from '../../logging/logger.interface';
import { FsUtilities, FsPath } from '../../utilities/fs.utilities';
import { BackupEntity } from '../backup-entity.model';
import { BackupResourceEntity } from '../backup-resource-entity.model';

const METADATA_FILENAME: string = 'metadata.json';

/**
 * A transport that saves the data to the local file system.
 */
export class FsBackupTransport implements BackupTransportInterface {

    private get logger(): LoggerInterface {
        return inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    constructor(readonly name: string, protected readonly backupBasePath: FsPath) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveBackups(existingEntities: BackupEntity[]): Promise<BackupEntity[]> {
        if (!await FsUtilities.exists(this.backupBasePath)) {
            return [];
        }

        const nodes: Dirent<string>[] = await FsUtilities.readdir(this.backupBasePath);
        const res: BackupEntity[] = (await Promise.all(nodes.map(async node => {
            if (!node.isDirectory()) {
                return;
            }
            if (existingEntities.map(e => e.name).includes(node.name)) {
                return;
            }
            const p: FsPath = FsUtilities.getPath(node.parentPath, node.name, METADATA_FILENAME);
            if (!await FsUtilities.exists(p)) {
                await this.logger.warn(`Could not find the metadata file needed to resolve a backup: "${p}"`);
                return;
            }
            const json: string = await FsUtilities.readFile(p);
            return JSON.parse(json) as BackupEntity;
        }))).filter(b => b != undefined);
        return res;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async storeData(data: Readable, backup: BackupEntity, resource: BackupResourceEntity): Promise<void> {
        const p: FsPath = this.getResourcePath(backup, resource);
        await FsUtilities.mkdir(this.getBackupPath(backup));
        await FsUtilities.createFile(this.getBackupMetadataPath(backup), JSON.stringify(backup));

        await pipeline(
            data,
            FsUtilities.createWriteStream(p)
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    retrieveData(backup: BackupEntity, resource: BackupResourceEntity): Readable | Promise<Readable> {
        const p: FsPath = this.getResourcePath(backup, resource);
        return FsUtilities.createReadStream(p);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteData(backup: BackupEntity, resource: BackupResourceEntity): Promise<void> {
        const p: FsPath = this.getResourcePath(backup, resource);
        await FsUtilities.rm(p);
    }

    private getResourcePath(backup: BackupEntity, resource: BackupResourceEntity): FsPath {
        return FsUtilities.getPath(this.getBackupPath(backup), resource.name);
    }

    private getBackupPath(backup: BackupEntity): FsPath {
        return FsUtilities.getPath(this.backupBasePath, backup.name);
    }

    private getBackupMetadataPath(backup: BackupEntity): FsPath {
        return FsUtilities.getPath(this.getBackupPath(backup), METADATA_FILENAME);
    }
}