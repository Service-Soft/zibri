import { FakeLdapDirectoryOptions } from './fake-ldap-directory-options.model';
import { FakeLdapDirectory } from './fake-ldap-directory.model';

/**
 * Starts a directory in the test's own process, reached over TLS on the loopback interface.
 * @param options - The entries of the directory.
 * @returns The started directory, which the test is responsible for stopping.
 */
export async function startFakeLdapDirectory(options: FakeLdapDirectoryOptions): Promise<FakeLdapDirectory> {
    const directory: FakeLdapDirectory = await FakeLdapDirectory.create(options);
    await directory.listen();
    return directory;
}