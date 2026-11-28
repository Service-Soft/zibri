import { DefinedPermissions, definePermissions } from './define-permissions.function';

/**
 * The tenant permissions the routes of the backup transports of Zibri check, in the tenant a request acts in: listing
 * the transports of that tenant and the kinds it may add, and adding, changing and deleting them. Spread them into the
 * tenant permissions of the application.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_BACKUP_TRANSPORT_PERMISSIONS = ['backup-transports.read', 'backup-transports.manage'] as const;

/**
 * {@link ZIBRI_BACKUP_TRANSPORT_PERMISSIONS}, by name.
 */
export const ZibriBackupTransportPermissions: DefinedPermissions<typeof ZIBRI_BACKUP_TRANSPORT_PERMISSIONS> = definePermissions(
    ZIBRI_BACKUP_TRANSPORT_PERMISSIONS
);
