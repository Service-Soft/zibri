import { WebDavBackupTransportOptions } from '../web-dav/web-dav-backup-transport-options.model';
import { NextcloudBackupReaders } from './nextcloud-backup-readers.model';

/**
 * Where and how a Nextcloud backup transport stores backups: `folder` below the url of `connection`, which is below
 * `/remote.php/dav/files/<user>/` of a user owning it, and who it is shared with to read.
 */
export type NextcloudBackupTransportOptions = WebDavBackupTransportOptions & {
    /**
     * The users and groups of the Nextcloud the folder is shared with, to read. Required, with an empty list for
     * nobody.
     */
    sharedWith: NextcloudBackupReaders
};
