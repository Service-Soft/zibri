import { WebDavStorageSession } from '../../storage/web-dav.storage-session';
import { Ms } from '../../utilities/ms';
import { WebDavClient } from '../../web-dav/web-dav-client';
import { BackupTransportSessionInterface } from './backup-transport-session.interface';
import { BaseBackupTransport } from './base.backup-transport';
import { resolveBackupKeySegments } from './resolve-backup-key-segments.function';
import { resolveBackupStorageNaming } from './resolve-backup-storage-naming.function';
import { WebDavBackupTransportOptions } from './web-dav/web-dav-backup-transport-options.model';

// a chunk of a few megabytes over a slow line, where the five seconds of the http client are too short
const DEFAULT_TIMEOUT_MS: number = Ms.MINUTE * 5;
// a request that fails with a 5xx or a 429 is sent again, where sending it again cannot change its outcome
const DEFAULT_ATTEMPTS: number = 3;

/**
 * A transport that stores backups in a folder of a WebDAV server: each key a file below `folder`, its segments the
 * folders leading to it. Of both versions, used as `v2`.
 *
 * A file is uploaded under a name of its own beside its key and moved onto the key once it arrived whole, so no
 * reader sees part of it. Backups are kept under `<folder>/.zibri-repository/`, and backups of format 1 under
 * `<folder>/<backup name>/`.
 */
export class WebDavBackupTransport extends BaseBackupTransport {
    private readonly client: WebDavClient;

    /**
     * Creates the transport keeping the backups in a folder of the given server.
     * @param name - The name of the transport.
     * @param options - The server, who logs in, the folder the backups are kept in, and how requests are sent.
     * @throws InternalError when the url of the connection is no http or https url, or a segment of the folder is
     * empty, `.` or `..`.
     */
    constructor(readonly name: string, private readonly options: WebDavBackupTransportOptions) {
        super();
        if (options.folder !== '') {
            resolveBackupKeySegments(name, options.folder);
        }
        this.client = new WebDavClient({
            connection: options.connection,
            network: options.network,
            timeoutInMs: options.timeoutInMs ?? DEFAULT_TIMEOUT_MS,
            attempts: options.attempts ?? DEFAULT_ATTEMPTS
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async openSession(): Promise<BackupTransportSessionInterface> {
        // every request stands on its own, so a session holds nothing open
        return await Promise.resolve(new WebDavStorageSession(resolveBackupStorageNaming(this.name), this.client, this.options.folder));
    }
}