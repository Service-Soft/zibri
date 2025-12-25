import { createReadStream, createWriteStream, Dirent } from 'fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

import { BackupTransportInterface } from './backup-transport.interface';
import { inject, ZIBRI_DI_TOKENS } from '../../di';
import { LoggerInterface } from '../../logging';
import { pathExists } from '../../utilities';
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

    constructor(readonly name: string, protected readonly backupBasePath: string) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveBackups(existingEntities: BackupEntity[]): Promise<BackupEntity[]> {
        if (!await pathExists(this.backupBasePath)) {
            return [];
        }

        const nodes: Dirent<string>[] = await readdir(this.backupBasePath, { withFileTypes: true });
        const res: BackupEntity[] = (await Promise.all(nodes.map(async node => {
            if (!node.isDirectory()) {
                return;
            }
            if (existingEntities.map(e => e.name).includes(node.name)) {
                return;
            }
            const p: string = path.join(node.parentPath, node.name, METADATA_FILENAME);
            if (!await pathExists(p)) {
                await this.logger.warn(`Could not find the metadata file needed to resolve a backup: "${p}"`);
                return;
            }
            const json: string = await readFile(p, 'utf8');
            return JSON.parse(json) as BackupEntity;
        }))).filter(b => b != undefined);
        return res;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async storeData(data: Readable, backup: BackupEntity, resource: BackupResourceEntity): Promise<void> {
        const p: string = this.getResourcePath(backup, resource);
        await mkdir(this.getBackupPath(backup), { recursive: true });
        await writeFile(this.getBackupMetadataPath(backup), JSON.stringify(backup), 'utf8');

        await pipeline(
            data,
            createWriteStream(p)
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    retrieveData(backup: BackupEntity, resource: BackupResourceEntity): Readable | Promise<Readable> {
        const p: string = this.getResourcePath(backup, resource);
        return createReadStream(p);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteData(backup: BackupEntity, resource: BackupResourceEntity): Promise<void> {
        const p: string = this.getResourcePath(backup, resource);
        await rm(p, { recursive: true });
    }

    private getResourcePath(backup: BackupEntity, resource: BackupResourceEntity): string {
        return path.join(this.getBackupPath(backup), resource.name);
    }

    private getBackupPath(backup: BackupEntity): string {
        return path.join(this.backupBasePath, backup.name);
    }

    private getBackupMetadataPath(backup: BackupEntity): string {
        return path.join(this.getBackupPath(backup), METADATA_FILENAME);
    }
}