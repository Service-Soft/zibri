import { SftpStorageOptions } from '../../../storage/sftp-storage-options.model';

/**
 * Where and how an SFTP backup transport stores backups: `path` is the folder on the server the backups are stored in.
 */
// the options of a server, which an SFTP file store is configured with as well
export type SftpBackupTransportOptions = SftpStorageOptions;