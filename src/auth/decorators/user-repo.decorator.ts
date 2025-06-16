import { DiToken } from '../../di';
import { GlobalRegistry } from '../../global';
import { Newable } from '../../types';
import { MetadataUtilities } from '../../utilities';
import { BaseUser, UserRepositories } from '../models';

// eslint-disable-next-line jsdoc/require-returns
/**
 * Marks the given class as a user repository.
 * This registers it to be injected directly, without using "@InjectRepository".
 *
 * If you store your user in a database, you probably want to extend "Repository<UserEntityClass>" and implement the constructor, so that everything works:.
 *
 * ```ts
 * \@UserRepo(User)
 * export class UserRepository extends Repository<User, UserCreateData>
 *     implements UserRepositoryInterface<Roles, User, JwtCredentials> {
 *
 *     constructor(
 *         \@InjectRepository(User)
 *         repo: Repository<User> // <-- The built in repository from zibri
 *     ) {
 *         super(User, repo);
 *     }
 *     // ...
 * }
 * ```
 */
export function UserRepo<T extends string, EntityType extends Newable<BaseUser<T>>>(): ClassDecorator {
    return target => {
        MetadataUtilities.setDiToken(target, target as unknown as DiToken<EntityType>);
        // eslint-disable-next-line unicorn/error-message
        const stack: string = new Error().stack ?? '';
        MetadataUtilities.setFilePath(target, stack);
        GlobalRegistry.injectables.push({
            token: target as unknown as DiToken<EntityType>,
            useClass: target as unknown as UserRepositories[number]
        });
        GlobalRegistry.userRepositories.push(target as unknown as UserRepositories[number]);
    };
}