
import { Injectable, InjectableOptions } from '../../di/decorators/injectable.decorator';
import { DiVariants } from '../../di/models/di-variant.model';
import { OmitStrict } from '../../types/omit-strict.type';

/**
 * Marks the given class as a user repository.
 * This registers it to be injected directly, without using "@InjectRepository".
 *
 * If you store your user in a data source, you probably want to extend "Repository<UserEntityClass>" and implement the constructor, so that everything works:.
 *
 * ```ts
 * \@UserRepo(User)
 * export class UserRepository extends Repository<User, UserCreateData>
 *     implements UserRepositoryInterface<Roles, User, JwtCredentials> {
 *
 *     constructor(
 *         \@InjectRepository(User)
 *         repo: Repository<User> // <-- The built in repository from Zibri
 *     ) {
 *         super(User, repo);
 *     }
 *     // ...
 * }
 * ```
 * @param options - Options for the user repo.
 */
export function UserRepo<T>(
    options: OmitStrict<InjectableOptions<T>, 'variant'> = {}
): ClassDecorator {
    return Injectable({ ...options, variant: DiVariants.USER_REPO });
}