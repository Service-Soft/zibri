import { createHash, Hash } from 'node:crypto';
import { Readable } from 'node:stream';

import { BackupResourceInterface } from '../backup/backup-resource.interface';
import { KeysetPage } from '../data-source/models/pagination-result.model';
import { Where } from '../data-source/models/where/where-filter.model';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { InternalError } from '../error-handling/internal-error.model';
import { type LoggerInterface } from '../logging/logger.interface';
import { TarEntry, TarUtilities } from '../utilities/tar.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { FileHashMismatchError } from './file-hash-mismatch.error';
import { FileRecord, FileRecordCreateData } from './file-record.model';
import { FileStoreEntry } from './stores/file-store-entry.model';
import { FileStoreInterface } from './stores/file-store.interface';

// how many rows are read at a time, both for a backup and for the check after a restore
const ROWS_PER_PAGE: number = 500;
// how many files without bytes the check after a restore names, of however many there are
const NAMED_FILES: number = 20;

/**
 * The rows read last at one moment of storing, and the keys a backup took of them.
 */
type StoredAtMoment = {
    /**
     * The moment, in milliseconds.
     */
    atMs: number,
    /**
     * The keys the backup took of the rows stored at that moment.
     */
    keys: Set<string>
};

/**
 * When the first row of a key was stored.
 */
type FirstStoredAt = Pick<FileRecord, 'key'> & {
    /**
     * The moment, or undefined when the key has no row.
     */
    minimum: Date | undefined
};

/**
 * A file store marked with `@Backup`, as the backup service backs it up: the bytes it holds of the files the rows of
 * `FileRecord` name, of the application or of one tenant, as a tar archive of their keys.
 *
 * A restore puts the bytes of the backup back under their keys and leaves every other key as it is: a key names
 * its bytes by their SHA-256, so what it holds is either those bytes or wrong. The bytes no row references then are
 * deleted by `FileCleanupCronJob`, as every other such bytes are.
 */
export class FileStoreBackupResource implements BackupResourceInterface {
    /**
     * Creates the resource of a file store.
     * @param store - The file store.
     * @param tenantId - The tenant whose files alone are backed up and restored, or undefined for every file.
     */
    constructor(
        readonly store: FileStoreInterface,
        private readonly tenantId?: string
    ) {}

    // read when used, as the file service reads it: the store is registered before any data source is
    private get recordRepository(): Repository<FileRecord, FileRecordCreateData> {
        return inject(repositoryTokenFor(FileRecord));
    }

    private get logger(): LoggerInterface {
        return inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    /**
     * The same store, backing up and restoring the files of one tenant alone.
     * @param tenantId - The tenant.
     * @returns The resource.
     */
    forTenant(tenantId: string): FileStoreBackupResource {
        return new FileStoreBackupResource(this.store, tenantId);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    validateBackupConfiguration(): void {
        // what the store needs, the file service checks when the application starts
    }

    /**
     * Reads the bytes of every file the rows of the store name, each key once, in the order the files were first
     * stored. A file whose bytes are missing or of another size is left out, and one whose bytes do not match their
     * SHA-256 is backed up as it is, which a restore refuses. Each is logged as an error naming the file.
     * @returns A tar archive of the keys and their bytes.
     */
    createBackupData(): Readable {
        return Readable.from(TarUtilities.pack(this.findStoredFiles()));
    }

    /**
     * Puts the bytes of a backup back under their keys, each once it matches the SHA-256 its key names. Bytes that do
     * not are left out, and logged.
     * @param backupData - What {@link createBackupData} produced.
     * @throws When the backup holds a key that is no key of a file, or of another tenant.
     */
    async restoreBackup(backupData: Readable): Promise<void> {
        const refused: string[] = [];
        await TarUtilities.unpack(backupData, async entry => {
            const sha256: string = this.validateKey(entry.name);
            let mismatched: boolean = false;
            /**
             * Reads the bytes of the entry, and fails after the last of them when they do not match the SHA-256 the key
             * names: a put that fails keeps what the key held.
             * @yields The bytes.
             */
            async function* readVerified(): AsyncGenerator<Buffer> {
                const hash: Hash = createHash('sha256');
                for await (const piece of entry.content) {
                    hash.update(piece);
                    yield piece;
                }
                if (hash.digest('hex') !== sha256) {
                    mismatched = true;
                    throw new InternalError(`The bytes of "${entry.name}" do not match the SHA-256 the key names.`);
                }
            }
            try {
                await this.store.put(entry.name, Readable.from(readVerified()));
            }
            catch (error) {
                if (!mismatched) {
                    throw error;
                }
                refused.push(entry.name);
            }
        });
        if (refused.length) {
            this.logger.warn(
                `The backup of the file store "${this.store.name}" holds bytes that do not match the SHA-256 their key names, `
                + `which were not put back: ${refused.join(', ')}.`
            );
        }
    }

    /**
     * Warns when files the rows name have no bytes in the store, such as after a restore of their rows alone, naming
     * the first of them and how many there are.
     * @param backupName - The backup restored.
     * @param resourceName - The name the backup records the store under, which a restore of its bytes names.
     */
    async warnAboutMissingFiles(backupName: string, resourceName: string): Promise<void> {
        // listed rather than asked for key by key: a page of keys is one request where each key would be one
        const stored: Set<string> = new Set();
        for await (const keys of this.store.findKeys(this.tenantId == undefined ? '' : `${this.tenantId}/`)) {
            for (const key of keys) {
                stored.add(key);
            }
        }
        const named: FileRecord[] = [];
        let missing: number = 0;
        let cursor: string | undefined;
        do {
            const page: KeysetPage<FileRecord> = await this.recordRepository.findAllAfter(
                cursor,
                ROWS_PER_PAGE,
                { where: this.resolveWhere(), acrossTenants: true }
            );
            for (const file of page.items.filter(f => !stored.has(f.key))) {
                missing++;
                if (named.length < NAMED_FILES) {
                    named.push(file);
                }
            }
            cursor = page.nextCursor;
        }
        while (cursor != undefined);
        if (!missing) {
            return;
        }
        const names: string = named.map(f => `"${f.name}" (${f.id})`).join(', ');
        this.logger.warn(
            `After the restore of the backup "${backupName}", ${missing} files of the file store "${this.store.name}" have no `
            + `bytes in it, such as ${names}. A restore of ${resourceName} from a backup holding them puts them back.`
        );
    }

    /**
     * Finds the files the rows of the store name, each key once, as the entries of a tar archive.
     *
     * In the order they were first stored, so that a file stored since a backup comes after every file it holds, and
     * a backup of the chunks of the files before is the same as the one before it stored.
     * @yields Each file.
     */
    private async* findStoredFiles(): AsyncGenerator<TarEntry> {
        // rows stored at the same moment, of a key whose first row is among them, may fall on two pages
        const last: StoredAtMoment = { atMs: Number.NaN, keys: new Set() };
        let cursor: string | undefined;
        do {
            // a page at a time rather than one read held open while every file is read from the store
            const page: KeysetPage<FileRecord> = await this.recordRepository.findAllAfter(
                cursor,
                ROWS_PER_PAGE,
                { where: this.resolveWhere(), order: { createdAt: 'ASC' }, acrossTenants: true }
            );
            const firstStoredAt: Map<string, number | undefined> = await this.resolveFirstStoredAt(page.items);
            for (const file of page.items) {
                const atMs: number = file.createdAt.getTime();
                // a row of a key stored before is passed over, as is one whose key has no row any more. A row committed
                // only after the walk passed its moment is not found by it, nor by the backup of its data source
                // taken before
                if (firstStoredAt.get(file.key) !== atMs) {
                    continue;
                }
                if (atMs !== last.atMs) {
                    last.atMs = atMs;
                    last.keys.clear();
                }
                if (last.keys.has(file.key)) {
                    continue;
                }
                last.keys.add(file.key);
                const entry: TarEntry | undefined = await this.resolveEntry(file);
                if (entry != undefined) {
                    yield entry;
                }
            }
            cursor = page.nextCursor;
        }
        while (cursor != undefined);
    }

    /**
     * Resolves when the files of the keys of some rows were first stored, of every row of the store.
     * @param files - The rows.
     * @returns The moment in milliseconds by key, undefined for a key that has no row any more.
     */
    private async resolveFirstStoredAt(files: FileRecord[]): Promise<Map<string, number | undefined>> {
        const keys: string[] = [...new Set(files.map(f => f.key))];
        if (!keys.length) {
            return new Map();
        }
        // a key holds its tenant, so its rows are of that tenant alone
        const groups: FirstStoredAt[] = await this.recordRepository.minimum(
            'createdAt',
            { where: { storeName: this.store.name, key: { oneOf: keys } }, groupBy: ['key'], acrossTenants: true }
        );
        return new Map(groups.map(g => [g.key, g.minimum?.getTime()]));
    }

    /**
     * Resolves the entry of a file of the archive, once the store holds as many bytes under its key as it was stored
     * with.
     * @param file - The row of the file.
     * @returns The entry, or undefined for a file whose bytes are missing or of another size, which is logged.
     */
    private async resolveEntry(file: FileRecord): Promise<TarEntry | undefined> {
        // before its header is written, which names its size
        const stored: FileStoreEntry | undefined = await this.store.findEntry(file.key);
        if (stored?.size !== file.size) {
            const held: string = stored == undefined ? 'nothing' : `${stored.size} bytes`;
            this.logger.error(new InternalError(
                `The file "${file.name}" (${file.id}) was not backed up: the file store "${this.store.name}" holds ${held} under `
                + `its key, where it was stored with ${file.size} bytes.`
            ));
            return undefined;
        }
        return { name: file.key, size: file.size, modifiedAt: file.createdAt, content: this.readChecked(file) };
    }

    /**
     * Reads the bytes of a file, and logs an error once they do not match the SHA-256 it was stored with.
     * @param file - The row of the file.
     * @yields The bytes.
     */
    private async* readChecked(file: FileRecord): AsyncGenerator<Buffer> {
        const hash: Hash = createHash('sha256');
        for await (const piece of await this.store.get(file.key, file.size)) {
            const bytes: Buffer = Buffer.isBuffer(piece) ? piece : Buffer.from(String(piece));
            hash.update(bytes);
            yield bytes;
        }
        // known at the end alone, after its bytes went into the backup: a restore refuses them
        if (hash.digest('hex') !== file.sha256) {
            this.logger.error(new FileHashMismatchError(file));
        }
    }

    /**
     * Validates a key a backup holds: one a file is kept under, `<tenant id>/<first two of the SHA-256>/<SHA-256>`,
     * and of the tenant restored when one is.
     * @param key - The key.
     * @returns The SHA-256 the key names.
     * @throws When it is not.
     */
    private validateKey(key: string): string {
        const [tenantId, group, sha256, ...rest] = key.split('/');
        if (tenantId == undefined || !UUIDUtilities.isUuid(tenantId) || sha256 == undefined || !/^[\da-f]{64}$/.test(sha256)
            || group !== sha256.slice(0, 2) || rest.length) {
            throw new InternalError(`The backup of the file store "${this.store.name}" holds "${key}", which is no key of a file.`);
        }
        if (this.tenantId != undefined && tenantId !== this.tenantId) {
            throw new InternalError(
                `The backup of the file store "${this.store.name}" of the tenant ${this.tenantId} holds "${key}" of another tenant.`
            );
        }
        return sha256;
    }

    private resolveWhere(): Where<FileRecord> {
        return this.tenantId == undefined ? { storeName: this.store.name } : { storeName: this.store.name, tenantId: this.tenantId };
    }
}