import { createReadStream, createWriteStream } from 'fs';
import { mkdir, rm } from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

import { BackupTransportInterface } from './backup-transport.interface';
import { BackupEntity } from '../backup-entity.model';
import { BackupResourceEntity } from '../backup-resource-entity.model';

/**
 * A transport that saves the data to the local file system.
 */
export class FsBackupTransport implements BackupTransportInterface {
    constructor(readonly name: string, protected readonly backupBasePath: string) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async storeData(data: Readable, backup: BackupEntity, resource: BackupResourceEntity): Promise<void> {
        const p: string = this.getPath(backup, resource);
        await mkdir(path.join(this.backupBasePath, backup.name), { recursive: true });

        await pipeline(
            data,
            createWriteStream(p)
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    retrieveData(backup: BackupEntity, resource: BackupResourceEntity): Readable | Promise<Readable> {
        const p: string = this.getPath(backup, resource);
        return createReadStream(p);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteData(backup: BackupEntity, resource: BackupResourceEntity): Promise<void> {
        const p: string = this.getPath(backup, resource);
        await rm(p, { recursive: true });
    }

    private getPath(backup: BackupEntity, resource: BackupResourceEntity): string {
        return path.join(this.backupBasePath, backup.name, resource.name);
    }
}