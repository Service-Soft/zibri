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
export abstract class BaseFsBackupTransport implements BackupTransportInterface {
    abstract readonly name: string;
    protected abstract readonly backupBasePath: FsPath;

    private get logger(): LoggerInterface {
        return inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveBackups(existingNames: string[]): Promise<string[]> {
        if (!await FsUtilities.exists(this.backupBasePath)) {
            return [];
        }

        const nodes: Dirent<string>[] = await FsUtilities.readdir(this.backupBasePath);
        const res: (string | undefined)[] = await Promise.all(nodes.map(async node => {
            if (!node.isDirectory() || existingNames.includes(node.name)) {
                return;
            }
            const p: FsPath = FsUtilities.getPath(node.parentPath, node.name, METADATA_FILENAME);
            if (!await FsUtilities.exists(p)) {
                // a folder holding data and no record is a backup that was interrupted before it
                // finished: the record is the last thing written, precisely so that this is what a
                // half-finished one looks like from here
                this.logger.warn(`Could not find the metadata file needed to resolve a backup: "${p}"`);
                return;
            }
            return await FsUtilities.readFile(p);
        }));
        return res.filter(b => b != undefined);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async storeData(data: Readable, backup: BackupEntity, resource: BackupResourceEntity): Promise<void> {
        const p: FsPath = this.getResourcePath(backup, resource);
        await FsUtilities.mkdir(this.getBackupPath(backup));

        await pipeline(
            data,
            FsUtilities.createWriteStream(p)
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async storeMetadata(backup: BackupEntity, document: string): Promise<void> {
        await FsUtilities.mkdir(this.getBackupPath(backup));
        await FsUtilities.createFile(this.getBackupMetadataPath(backup), document);
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
        // the record went first, so the last resource to go empties the folder. Left behind, it would be
        // resolved as a backup that was interrupted, and warned about on every sync
        await FsUtilities.rmIfEmpty(this.getBackupPath(backup));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteMetadata(backup: BackupEntity): Promise<void> {
        await FsUtilities.rm(this.getBackupMetadataPath(backup));
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