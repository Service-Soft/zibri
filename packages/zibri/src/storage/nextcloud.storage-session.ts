import { NextcloudBackupReaders } from '../backup/transports/nextcloud/nextcloud-backup-readers.model';
import { InternalError } from '../error-handling/internal-error.model';
import { PromiseUtilities } from '../utilities/promise.utilities';
import { NextcloudClient } from '../web-dav/nextcloud/nextcloud-client';
import { NextcloudShare } from '../web-dav/nextcloud/nextcloud-share.model';
import { NextcloudTrashBinEntry } from '../web-dav/nextcloud/nextcloud-trash-bin-entry.model';
import { WebDavNotFoundError } from '../web-dav/web-dav-not-found.error';
import { StorageNaming } from './storage-naming.model';
import { WebDavStorageSession } from './web-dav.storage-session';

// what a share to read is permitted, as Nextcloud sums its permissions: reading alone, and no sharing on
const READ_PERMISSION: number = 1;
// how many deletions of the trash bin one call sends at once
const DELETIONS_AT_ONCE: number = 8;

/**
 * A user or a group the folder is shared with.
 */
type Reader = {
    /**
     * Whether it is a user or a group.
     */
    type: 'user' | 'group',
    /**
     * The id of the user or the group.
     */
    shareWith: string
};

/**
 * A session with a folder of a Nextcloud, which only the user of the connection writes to and the users and groups
 * of the options read.
 *
 * Before the first put of a session, every share of the folder is checked: a share with a user or a group that lets
 * them do more than read is made read-only again, a share beyond the users and groups of the Nextcloud, such as a
 * link, is deleted, and a reader the folder is not shared with yet gets a share to read. What a delete removed is
 * deleted from the trash bin of the user as well, so that it frees its storage.
 */
export class NextcloudStorageSession extends WebDavStorageSession {
    /**
     * Creates the session with a folder of a Nextcloud.
     * @param naming - How the errors name the store.
     * @param nextcloud - The client of the Nextcloud, logged in as the user owning the folder.
     * @param folder - The folder the keys are below, relative to the url of the connection, among the files of its
     * user.
     * @param readers - The users and groups the folder is shared with, to read.
     */
    constructor(
        naming: StorageNaming,
        private readonly nextcloud: NextcloudClient,
        folder: string,
        private readonly readers: NextcloudBackupReaders
    ) {
        super(naming, nextcloud, folder);
    }

    protected override async prepareWrite(): Promise<void> {
        const shares: NextcloudShare[] = await this.findSharesCreatingFolder();
        await Promise.all(shares.map(async share => await this.validateShare(share)));
        const wanted: Reader[] = [
            ...this.readers.users.map((user): Reader => ({ type: 'user', shareWith: user })),
            ...this.readers.groups.map((group): Reader => ({ type: 'group', shareWith: group }))
        ];
        const missing: Reader[] = wanted
            .filter(reader => !shares.some(share => share.type === reader.type && share.shareWith === reader.shareWith));
        await Promise.all(missing.map(async reader => await this.createShare(reader)));
    }

    /**
     * Shares the folder with a reader, to read.
     * @param reader - The user or the group.
     */
    private async createShare(reader: Reader): Promise<void> {
        try {
            await this.nextcloud.createShare({ ...reader, path: this.folder, permissions: READ_PERMISSION });
        }
        catch (error) {
            // a session of another resource that shared it in the meantime, which Nextcloud refuses a second share for
            const shares: NextcloudShare[] = await this.nextcloud.findShares(this.folder);
            const sharedMeanwhile: boolean = shares.some(
                share => share.type === reader.type && share.shareWith === reader.shareWith && share.permissions === READ_PERMISSION
            );
            if (sharedMeanwhile) {
                return;
            }
            throw error;
        }
        this.logger.info(
            `Shared the folder "${this.folder}" of the ${this.naming.subject} with the ${reader.type} "${reader.shareWith}", to read.`
        );
    }

    protected override async handleDeleted(paths: string[]): Promise<void> {
        const deleted: Set<string> = new Set(paths);
        try {
            // by where each was, rather than all the trash bin holds of the folder: what somebody else deleted there
            // is theirs to bring back
            const trashed: NextcloudTrashBinEntry[] = (await this.nextcloud.findTrashBinEntries(this.folder))
                .filter(entry => deleted.has(entry.originalPath));
            await PromiseUtilities.allChunked(
                trashed,
                async entry => await this.nextcloud.deleteTrashBinEntry(entry),
                { chunkSize: DELETIONS_AT_ONCE }
            );
        }
        catch (error) {
            // the keys are deleted all the same, and Nextcloud expires what its trash bin keeps by its own rules. A
            // failure here stops nothing else a garbage collection frees
            this.logger.warn(
                `Could not delete what the ${this.naming.subject} deleted from the trash bin of Nextcloud, where it takes up `
                + `space until Nextcloud expires it: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Finds the shares of the folder, creating the folder when it does not exist yet.
     * @returns The shares.
     */
    private async findSharesCreatingFolder(): Promise<NextcloudShare[]> {
        try {
            return await this.nextcloud.findShares(this.folder);
        }
        catch (error) {
            // the folder of the connection is not created: a url that leads nowhere is a mistake to report
            if (!(error instanceof WebDavNotFoundError) || this.folder === '') {
                throw error;
            }
            await this.nextcloud.createFolder(this.folder);
            return [];
        }
    }

    /**
     * Makes a share of the folder what the folder of backups allows, and reports what it changed.
     * @param share - The share.
     */
    private async validateShare(share: NextcloudShare): Promise<void> {
        switch (share.type) {
            case 'user':
            case 'group': {
                const readers: string[] = share.type === 'user' ? this.readers.users : this.readers.groups;
                // left rather than deleted: a reader taken out of the options may still need the backups on their
                // devices, and a share to read lets nobody change one
                if (share.shareWith == undefined || !readers.includes(share.shareWith)) {
                    this.logger.warn(
                        `The folder "${this.folder}" of the ${this.naming.subject}`
                        + ` is shared with the ${share.type} "${share.shareWith ?? ''}", `
                        + 'which its options do not name. The share is left as it is.'
                    );
                }
                if (share.permissions === READ_PERMISSION) {
                    return;
                }
                await this.nextcloud.updateShare(share.id, { permissions: READ_PERMISSION });
                this.logger.error(new InternalError(
                    `The folder "${this.folder}" of the ${this.naming.subject}`
                    + ` was shared with the ${share.type} "${share.shareWith ?? ''}" `
                    + `with the permissions ${share.permissions}, which allow more than reading. The share ${share.id} is read-only again.`
                ));
                return;
            }
            case 'link':
            case 'other': {
                // deleted rather than made read-only: the options name users and groups of the Nextcloud alone, so
                // nothing ever asked for a share reaching anyone else, and a backup has no place in public
                await this.nextcloud.deleteShare(share.id);
                this.logger.error(new InternalError(
                    `The folder "${this.folder}" of the ${this.naming.subject} was shared `
                    + `${share.type === 'link' ? 'by a link' : 'beyond the users and groups of the Nextcloud'}. `
                    + `The share ${share.id} is deleted.`
                ));
            }
        }
    }
}