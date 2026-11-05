import { HashDescriptor } from './hash-descriptor';
import { ModelRegistry } from './model.registry';
import { PasswordPolicy } from '../../auth/password-policy/password-policy.model';
import { PasswordPolicyUtilities } from '../../auth/password-policy/password-policy.utilities';
import { InternalError } from '../../error-handling/internal-error.model';
import { Newable } from '../../types/newable.type';

/**
 * Validates every password a write sets against the password policy, before any of them is hashed:
 * the passwords of the row, and of the rows written along with it.
 * @param data - The row, or the change to it.
 * @param entityClass - The entity of the row.
 * @param policy - The password policy, undefined when the application provides none.
 * @throws What the policy throws for a password it refuses, and when a password is written without a policy.
 */
export async function validatePasswordProperties<Data, EntityClass>(
    data: Data,
    entityClass: Newable<EntityClass>,
    policy: PasswordPolicy | undefined
): Promise<void> {
    if (data == undefined || typeof data !== 'object') {
        return;
    }
    await validatePasswordPropertiesRecursive(data, entityClass.name, ModelRegistry.get(entityClass).hashDescriptor, policy, new Set());
}

// eslint-disable-next-line jsdoc/require-jsdoc
async function validatePasswordPropertiesRecursive<EntityClass>(
    data: object,
    entityName: string,
    descriptor: HashDescriptor<EntityClass>,
    policy: PasswordPolicy | undefined,
    visited: Set<unknown>
): Promise<void> {
    // the same walk the hashing takes after this, cyclic relations and two paths to one row included
    if (visited.has(data)) {
        return;
    }
    visited.add(data);

    for (const key of descriptor.passwordKeys) {
        const password: unknown = Reflect.get(data, key);
        if (typeof password !== 'string') {
            continue;
        }
        // the application starting refuses an entity holding a password without a policy, unless a hash
        // service of its own stands in for the one that checks
        if (policy == undefined) {
            throw new InternalError(`${entityName}.${key} is a password, and no ZIBRI_DI_TOKENS.PASSWORD_POLICY says what one has to be.`);
        }
        await PasswordPolicyUtilities.validatePassword(password, policy);
    }

    for (const nested of descriptor.nestedValues(data)) {
        // a row this one references is not written along with it, so it is not hashed either
        if (nested.related) {
            continue;
        }
        await validatePasswordPropertiesRecursive(nested.data, `${entityName}.${nested.path}`, nested.descriptor, policy, visited);
    }
}