/**
 * What the routes of the backup transports of Zibri take at most, so that a frontend checks a value before it sends it.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_BACKUP_TRANSPORT_LIMITS = {
    /**
     * The longest name of a transport.
     */
    NAME_MAX_LENGTH: 200
} as const;
