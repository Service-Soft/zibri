import { FakeLdapEntry } from './fake-ldap-entry.model.ts';

/**
 * What a fake directory is started with.
 */
export type FakeLdapDirectoryOptions = {
    /**
     * The entries of the directory, the service account included.
     */
    entries: FakeLdapEntry[]
};