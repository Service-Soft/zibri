import type { Client, Filter } from 'ldapts';

import { InternalError } from '../../../../error-handling/internal-error.model';
import { BaseUser } from '../../../models/base-user.model';
import { BaseLdapAuthenticator } from '../base-ldap.authenticator';
import { Ldapts } from '../ldapts.type';

/**
 * The matching rule of Active Directory that follows a group's members through the groups among them,
 * as deep as they go (LDAP_MATCHING_RULE_IN_CHAIN).
 */
const IN_CHAIN_RULE: string = '1.2.840.113556.1.4.1941';

/**
 * Authenticates a user by the password of their account in Active Directory, or a Samba domain.
 *
 * Users sign in with their account name (`anna`), their user principal name (`anna@example.com`) or
 * their down-level logon name (`EXAMPLE\anna`). An account is linked to a user by its `objectGUID`,
 * written the way Active Directory shows it.
 */
export abstract class BaseActiveDirectoryAuthenticator<
    RoleType extends string,
    UserType extends BaseUser<RoleType> = BaseUser<RoleType>
> extends BaseLdapAuthenticator<RoleType, UserType> {
    /**
     * The NetBIOS name of the domain, eg. `EXAMPLE`: what a down-level logon name like `EXAMPLE\anna`
     * starts with. A name that starts with another domain's is refused.
     */
    abstract readonly netbiosName: string;

    override readonly idAttribute: string = 'objectGUID';

    override readonly entryFilter: string = '(&(objectCategory=person)(objectClass=user))';

    override readonly usernameAttributes: string[] = ['sAMAccountName', 'userPrincipalName'];

    override readonly groupFilter: string = '(objectClass=group)';

    /**
     * Writes an `objectGUID` the way Active Directory shows it, eg. `5f2c4b1e-…`: its first three
     * parts are stored with their bytes in reverse order.
     * @param value - The 16 bytes of the `objectGUID`.
     * @returns The GUID.
     * @throws InternalError when the value is not 16 bytes long.
     */
    protected override toEntryId(value: Buffer): string {
        if (value.length !== 16) {
            throw new InternalError(`${this.constructor.name}: an objectGUID has 16 bytes, not ${value.length}.`);
        }
        return [
            Buffer.from(value.subarray(0, 4)).reverse(),
            Buffer.from(value.subarray(4, 6)).reverse(),
            Buffer.from(value.subarray(6, 8)).reverse(),
            value.subarray(8, 10),
            value.subarray(10, 16)
        ].map(part => part.toString('hex')).join('-');
    }

    /**
     * The filter for the account that has the typed name. A down-level logon name, `DOMAIN\name`, is
     * the account name `name` when `DOMAIN` is this domain.
     * @param username - The typed name.
     * @returns The filter, or undefined when the name belongs to another domain.
     */
    protected override toUsernameFilter(username: string): Filter | undefined {
        // an account name never holds a backslash, so one always separates a domain
        const separator: number = username.indexOf('\\');
        if (separator === -1) {
            return super.toUsernameFilter(username);
        }
        // another domain of the forest may have an account of the same name, which is somebody else
        const accountName: string = username.slice(separator + 1);
        if (username.slice(0, separator).toLowerCase() !== this.netbiosName.toLowerCase() || !accountName) {
            return undefined;
        }
        const ldapts: Ldapts = this.resolveLdapts();
        return new ldapts.EqualityFilter({ attribute: 'sAMAccountName', value: accountName });
    }

    /**
     * Finds the groups an account is a member of, directly or through other groups, in one search.
     * The primary group of the account, usually `Domain Users`, is not among them.
     * @param client - The connection, bound as the service account.
     * @param dn - The account.
     * @param groupSearchBase - Where the groups are searched for.
     * @returns The distinguished names of the groups.
     */
    protected override async resolveGroups(client: Client, dn: string, groupSearchBase: string): Promise<string[]> {
        const ldapts: Ldapts = this.resolveLdapts();
        const { searchEntries } = await client.search(groupSearchBase, {
            scope: 'sub',
            filter: new ldapts.AndFilter({
                filters: [
                    ldapts.FilterParser.parseString(this.groupFilter),
                    new ldapts.ExtensibleFilter({ matchType: this.memberAttribute, rule: IN_CHAIN_RULE, value: dn })
                ]
            }),
            // no attributes, only the names of the groups (RFC 4511, 4.5.1.8)
            attributes: ['1.1']
        });
        return searchEntries.map(group => group.dn);
    }
}