import { once } from 'node:events';
import { PassThrough } from 'node:stream';

import { type BaseEntity } from '../../../entity/base-entity.model';
import { InternalError } from '../../../error-handling/internal-error.model';
import { FsPath } from '../../../utilities/fs.utilities';
import { StagedSortUtilities } from '../../../utilities/staged-sort.utilities';
import { type ValKeyRepositoryDriver } from '../../driver/val-key.repository-driver';

/**
 * How many entries a page of the sorted ones holds.
 */
const SORTED_PAGE_ENTRIES: number = 250;

/**
 * What separates the parts of an entry as it is sorted: the entry first, so that the rows holding one are
 * next to each other. JSON, which every value of an entry is written as, holds it only escaped.
 */
const SEPARATOR: string = '\u0000';

/**
 * A row of one entity, and how the check reads it.
 */
export type ValKeyCheckedEntity = {
    /**
     * The driver reading the rows of the entity.
     */
    driver: ValKeyRepositoryDriver<BaseEntity>,
    /**
     * The name of the entity, as a duplicate found names it.
     */
    name: string
};

/**
 * Holds what a backup reads a batch at a time to the uniques of the entities: two rows read at different
 * moments, around a write moving a unique value from one to the other, can both hold it, and a restore of
 * that backup refuses it, as does a start of the application over it.
 *
 * The entries are sorted on the instance's disk, encrypted, as the names of the keys are, so that what is
 * held stays a run of them however many rows there are.
 */
export class ValKeyBackupUniqueCheck {
    private readonly entries: PassThrough = new PassThrough({ objectMode: true });

    private readonly duplicate: Promise<string | undefined>;

    /**
     * Starts a check, sorting the entries as they are added.
     * @param entities - The drivers of the entities backed up, each with the name of its entity.
     * @param stagingFolder - Where the entries are sorted, on this instance's disk.
     */
    constructor(private readonly entities: ValKeyCheckedEntity[], stagingFolder: FsPath) {
        this.duplicate = this.findDuplicate(stagingFolder);
        // read once the backup was, and never left unhandled before then

        this.duplicate.catch(() => undefined);
    }

    /**
     * Finds the entity whose row a key holds, among those with a unique.
     * @param key - The key, a hash.
     * @returns The entity, or undefined when the key holds no row of one with a unique.
     */
    findEntity(key: string): ValKeyCheckedEntity | undefined {
        return this.entities.find(e => e.driver.findRowId(key) != undefined);
    }

    /**
     * Adds the entries a row read takes up.
     * @param entity - Its entity, as {@link findEntity} found it.
     * @param key - The key of the row.
     * @param fields - What it held, read in the same step the backup read it, or undefined when it is no row.
     */
    async add(entity: ValKeyCheckedEntity, key: string, fields: Record<string, string> | undefined): Promise<void> {
        const id: string | undefined = entity.driver.findRowId(key);
        if (id == undefined || fields == undefined) {
            return;
        }
        const lines: string[] = entity.driver.resolveUniqueEntries(fields)
            .map(({ entry, properties }) => [entry, id, entity.name, properties.join(', ')].join(SEPARATOR));
        if (lines.length && !this.entries.write(lines)) {
            await once(this.entries, 'drain');
        }
    }

    /**
     * Validates, once every row was read, that no two rows read hold the same unique entry.
     * @throws When two do, naming the entity, the unique and the rows.
     */
    async validate(): Promise<void> {
        this.entries.end();
        const duplicate: string | undefined = await this.duplicate;
        if (duplicate != undefined) {
            throw new InternalError(duplicate);
        }
    }

    /**
     * Stops the check, for a backup that ended without being read to its end.
     */
    abort(): void {
        this.entries.destroy();
    }

    private async findDuplicate(stagingFolder: FsPath): Promise<string | undefined> {
        let found: string | undefined;
        let previous: string[] | undefined;
        try {
            // read to the end even once one is found, so that adding never waits on a check that stopped reading
            for await (const page of StagedSortUtilities.sortNames(this.entries, stagingFolder, SORTED_PAGE_ENTRIES)) {
                for (const line of page) {
                    const parts: string[] = line.split(SEPARATOR);
                    const [entry, id, entityName, properties] = parts;
                    if (found == undefined && previous != undefined && previous[0] === entry && previous[1] !== id) {
                        // without the value, which can be what a row holds, such as an email address
                        found = `The backup read the rows ${previous[1]} and ${id} of ${entityName} at different moments,`
                            + ` both holding the same ${properties}, which a restore of it refuses:`
                            + ' a write moved the value from one to the other while the backup read'
                            + ' them. Take the backup again, or set backupMode to \'snapshot\' to read every key at one moment.';
                    }
                    previous = parts;
                }
            }
        }
        catch (error) {
            // so that a backup waiting to add more fails rather than waiting for good
            this.entries.destroy(error instanceof Error ? error : new InternalError(String(error)));
            throw error;
        }
        return found;
    }
}