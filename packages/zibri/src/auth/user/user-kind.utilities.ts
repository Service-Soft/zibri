import { ServiceAccountRefusedError } from '../../error-handling/errors/service-account-refused.error';
import { type BaseUser } from '../models/base-user.model';
import { type UserKind } from '../models/user-kind.type';

/**
 * What a user is, a person or a service account, and the checks that keep a service account to its API keys.
 */
export abstract class UserKindUtilities {
    /**
     * Every kind, by itself, as a column of a kind declares its values.
     */
    static readonly KINDS: Readonly<Record<UserKind, UserKind>> = { person: 'person', service: 'service' };

    /**
     * The kind of a user. A user stored before users had a kind is a person.
     * @param user - The user.
     * @returns `'service'` for a service account, `'person'` otherwise.
     */
    static getKind(user: Pick<BaseUser<string>, 'kind'>): UserKind {
        return user.kind ?? 'person';
    }

    /**
     * The kind of a user, when the value names one: a user read from its repository does, a principal claimed by a
     * credential does not.
     * @param user - The user, or what a credential claims of them.
     * @returns The kind, or undefined when the value carries none.
     */
    static findKind(user: object | undefined): UserKind | undefined {
        if (user == undefined || !('kind' in user)) {
            return undefined;
        }
        // read off a row of the user entity, whose column holds one of the two, or nothing for a user stored before it
        return user.kind === 'service' ? 'service' : 'person';
    }

    /**
     * Validates that a user is a person, who may log in and hold what a login takes.
     * @param user - The user.
     * @throws {ServiceAccountRefusedError} For a service account.
     */
    static validatePerson(user: Pick<BaseUser<string>, 'kind'>): void {
        if (this.getKind(user) === 'service') {
            throw new ServiceAccountRefusedError();
        }
    }
}
