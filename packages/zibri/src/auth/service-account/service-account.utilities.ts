import { type RepositoryTransaction } from '../../data-source/transaction/repository-transaction.type';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { NotFoundError } from '../../error-handling/errors/not-found.error';
import { $ts } from '../../localization/translate.function';
import { type BaseUser } from '../models/base-user.model';
import { UserKindUtilities } from '../user/user-kind.utilities';

/**
 * Finds the service accounts the routes of the service accounts reach.
 */
export abstract class ServiceAccountUtilities {
    /**
     * Resolves a service account by its id.
     * @param id - The id of the user.
     * @param transaction - The transaction to read in, if any.
     * @returns The service account.
     * @throws {NotFoundError} When no user has the id, or the user is a person.
     */
    static async resolveServiceAccount(id: string, transaction: RepositoryTransaction | undefined): Promise<BaseUser<string>> {
        const user: BaseUser<string> | undefined = await inject(ZIBRI_DI_TOKENS.USER_SERVICE)
            .findById(id, { required: false, transaction });
        // a person is not reached through these routes, which hand out keys and delete what they reach, as if there
        // were no user of the id
        if (user == undefined || UserKindUtilities.getKind(user) !== 'service') {
            throw new NotFoundError($ts`The service account does not exist.`);
        }
        return user;
    }

    /**
     * Gets the name of a service account, which its email starts with.
     * @param account - The service account.
     * @returns The local part of its email.
     */
    static getName(account: Pick<BaseUser<string>, 'email'>): string {
        return account.email.slice(0, account.email.lastIndexOf('@'));
    }
}