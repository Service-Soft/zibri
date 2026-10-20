import { Injectable, InjectableOptions } from '../../di/decorators/injectable.decorator.ts';
import { DiVariants } from '../../di/models/di-variant.model.ts';
import { OmitStrict } from '../../types/omit-strict.type.ts';

/**
 * Marks the given class as the membership repository of the application.
 * This registers it to be injected directly, without using "@InjectRepository".
 *
 * If you store your memberships in a data source, extend "Repository<MembershipEntityClass>":.
 *
 * ```ts
 * \@MembershipRepo()
 * export class MembershipRepository extends Repository<Membership>
 *     implements MembershipRepositoryInterface<Roles, Membership> {
 *
 *     constructor(
 *         \@InjectRepository(Membership)
 *         repo: Repository<Membership> // <-- The built in repository from Zibri
 *     ) {
 *         super(Membership, repo);
 *     }
 *     // ...
 * }
 * ```
 * @param options - Options for the membership repo.
 */
export function MembershipRepo<T>(
    options: OmitStrict<InjectableOptions<T>, 'variant'> = {}
): ClassDecorator {
    return Injectable({ ...options, variant: DiVariants.MEMBERSHIP_REPO });
}