import { NextcloudStorageSession } from '../../storage/nextcloud.storage-session';
import { Ms } from '../../utilities/ms';
import { NextcloudClient } from '../../web-dav/nextcloud/nextcloud-client';
import { BackupTransportSessionInterface } from './backup-transport-session.interface';
import { BaseBackupTransport } from './base.backup-transport';
import { NextcloudBackupTransportOptions } from './nextcloud/nextcloud-backup-transport-options.model';
import { resolveBackupKeySegments } from './resolve-backup-key-segments.function';
import { resolveBackupStorageNaming } from './resolve-backup-storage-naming.function';

// a chunk of a few megabytes over a slow line, where the five seconds of the http client are too short
const DEFAULT_TIMEOUT_MS: number = Ms.MINUTE * 5;
// a request that fails with a 5xx or a 429 is sent again, where sending it again cannot change its outcome
const DEFAULT_ATTEMPTS: number = 3;

/**
 * A transport that stores backups in a folder of a Nextcloud, as `WebDavBackupTransport` does, which only the user of
 * the connection writes to: each key a file below `folder`. Of both versions, used as `v2`.
 *
 * Before a session writes, every share of the folder is checked: a share with a user or a group that allows more than
 * reading is made read-only again, a share by link or beyond the users and groups of the Nextcloud is deleted, both
 * logged as an error, and the users and groups of `sharedWith` get a share to read where they have none. What the
 * transport deletes, it deletes from the trash bin of the user as well.
 */
export class NextcloudBackupTransport extends BaseBackupTransport {
    private readonly client: NextcloudClient;

    /**
     * Creates the transport keeping the backups in a folder of the given Nextcloud.
     * @param name - The name of the transport.
     * @param options - The Nextcloud, the user owning the folder, the folder, who it is shared with, and how requests
     * are sent.
     * @throws InternalError when the url of the connection is not below `/remote.php/dav/` of an http or https url,
     * or a segment of the folder is empty, `.` or `..`.
     */
    constructor(readonly name: string, private readonly options: NextcloudBackupTransportOptions) {
        super();
        if (options.folder !== '') {
            resolveBackupKeySegments(name, options.folder);
        }
        this.client = new NextcloudClient({
            connection: options.connection,
            network: options.network,
            timeoutInMs: options.timeoutInMs ?? DEFAULT_TIMEOUT_MS,
            attempts: options.attempts ?? DEFAULT_ATTEMPTS
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async openSession(): Promise<BackupTransportSessionInterface> {
        // every request stands on its own, so a session holds nothing open
        return await Promise.resolve(new NextcloudStorageSession(
            resolveBackupStorageNaming(this.name),
            this.client,
            this.options.folder,
            this.options.sharedWith
        ));
    }
}