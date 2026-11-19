import { Repository } from '../../data-source/repository/repository';
import { INVITATION_REPOSITORY } from '../../data-source/repository/repository-kind.model';
import { type RepositoryTransaction } from '../../data-source/transaction/repository-transaction.type';
import { Newable } from '../../types/newable.type';
import { BaseUser } from '../models/base-user.model';
import { BaseInvitation } from './base-invitation.model';
import { InvitationRepositoryInterface } from './invitation-repository.interface';

/**
 * An invitation repository class built over the repository a data source builds for its entity, which a class of
 * your own extends with `createInvitedUser`.
 */
export type InvitationRepositoryClass<T extends BaseInvitation> = abstract new (
    entityClass: Newable<T>,
    repo: Repository<T>
) => Repository<T> & InvitationRepositoryInterface<T>;

// eslint-disable-next-line jsdoc/require-returns
/**
 * Defines the base of an invitation repository: a repository of the invitation entity, whose `createInvitedUser`
 * your class implements, since only your application knows what its users are created with. Extend the class it
 * returns and declare it with `@RepositoryFor(Invitation)`.
 */
export function BaseInvitationRepository<T extends BaseInvitation>(): InvitationRepositoryClass<T> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    abstract class InvitationRepository extends Repository<T> implements InvitationRepositoryInterface<T> {
        // a getter for the reason BaseUserRepository gives
        // eslint-disable-next-line jsdoc/require-jsdoc, typescript/class-literal-property-style
        get [INVITATION_REPOSITORY](): true {
            return true;
        }

        abstract createInvitedUser(invitation: T, transaction: RepositoryTransaction | undefined): Promise<BaseUser<string>>;
    }

    return InvitationRepository;
}