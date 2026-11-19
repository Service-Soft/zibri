import { readFile } from 'node:fs/promises';

import { BackupEntity } from '../../backup/backup-entity.model';
import { BACKUP_REPOSITORY_FOLDER } from '../../backup/backup-format';
import { BackupResourceEntity } from '../../backup/backup-resource-entity.model';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { PlainChunk } from './plain-chunk.model';

const PLAIN_CHUNKS_FOLDER: string = 'plain-chunks';

/**
 * Where a backup of format 2 is found in the folder of a transport keeping files, for tests that look
 * at what it stored.
 */
export abstract class BackupLayoutTestUtilities {
    /**
     * The folder of a backup: its record, and the manifest of each resource.
     * @param root - The folder of the transport.
     * @param backup - The backup.
     * @returns The folder.
     */
    static resolveBackupFolder(root: FsPath, backup: Pick<BackupEntity, 'id'>): FsPath {
        return FsUtilities.getPath(root, BACKUP_REPOSITORY_FOLDER, 'backups', backup.id);
    }

    /**
     * The record of a backup.
     * @param root - The folder of the transport.
     * @param backup - The backup.
     * @returns The file.
     */
    static resolveRecordPath(root: FsPath, backup: Pick<BackupEntity, 'id'>): FsPath {
        return FsUtilities.getPath(this.resolveBackupFolder(root, backup), 'record.json');
    }

    /**
     * What a resource of a backup is stored under: the manifest of its chunks, or its data in one piece.
     * @param root - The folder of the transport.
     * @param backup - The backup.
     * @param resource - The resource.
     * @returns The file.
     */
    static resolveResourcePath(root: FsPath, backup: Pick<BackupEntity, 'id'>, resource: Pick<BackupResourceEntity, 'id'>): FsPath {
        return FsUtilities.getPath(this.resolveBackupFolder(root, backup), resource.id);
    }

    /**
     * The first chunk of an unencrypted resource stored as chunks, which its manifest names right after
     * its two bytes of header.
     * @param root - The folder of the transport.
     * @param backup - The backup.
     * @param resource - The resource.
     * @returns The id of the chunk and its file.
     */
    static async resolveFirstPlainChunk(
        root: FsPath,
        backup: Pick<BackupEntity, 'id'>,
        resource: Pick<BackupResourceEntity, 'id'>
    ): Promise<PlainChunk> {
        const manifest: Buffer = await readFile(this.resolveResourcePath(root, backup, resource));
        const id: string = manifest.subarray(2, 34).toString('hex');
        return { id, path: FsUtilities.getPath(root, BACKUP_REPOSITORY_FOLDER, PLAIN_CHUNKS_FOLDER, id.slice(0, 2), id) };
    }

    /**
     * Every chunk an unencrypted resource stored as chunks names, which its manifest lists after its two
     * bytes of header, each by its id and its length.
     * @param root - The folder of the transport.
     * @param backup - The backup.
     * @param resource - The resource.
     * @returns The files of the chunks, each once.
     */
    static async resolvePlainChunkPaths(
        root: FsPath,
        backup: Pick<BackupEntity, 'id'>,
        resource: Pick<BackupResourceEntity, 'id'>
    ): Promise<FsPath[]> {
        const entries: Buffer = (await readFile(this.resolveResourcePath(root, backup, resource))).subarray(2);
        const paths: Set<FsPath> = new Set();
        for (let i: number = 0; i < entries.length; i += 36) {
            const id: string = entries.subarray(i, i + 32).toString('hex');
            paths.add(FsUtilities.getPath(root, BACKUP_REPOSITORY_FOLDER, PLAIN_CHUNKS_FOLDER, id.slice(0, 2), id));
        }
        return [...paths];
    }

    /**
     * Every chunk the folder of a transport holds, encrypted or not.
     * @param root - The folder of the transport.
     * @returns The files of the chunks.
     */
    static async findChunkPaths(root: FsPath): Promise<FsPath[]> {
        const paths: FsPath[] = [];
        for (const folder of [this.resolveChunksFolder(root), FsUtilities.getPath(root, BACKUP_REPOSITORY_FOLDER, PLAIN_CHUNKS_FOLDER)]) {
            if (!await FsUtilities.exists(folder)) {
                continue;
            }
            for (const group of await FsUtilities.readdir(folder)) {
                for (const file of await FsUtilities.readdir(FsUtilities.getPath(folder, group.name))) {
                    paths.push(FsUtilities.getPath(folder, group.name, file.name));
                }
            }
        }
        return paths;
    }

    /**
     * The folder the chunks of encrypted resources are kept in.
     * @param root - The folder of the transport.
     * @returns The folder.
     */
    static resolveChunksFolder(root: FsPath): FsPath {
        return FsUtilities.getPath(root, BACKUP_REPOSITORY_FOLDER, 'chunks');
    }
}