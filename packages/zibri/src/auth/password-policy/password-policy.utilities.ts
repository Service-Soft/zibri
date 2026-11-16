import { PasswordPolicy } from './password-policy.model';
import { PasswordRefusedError } from '../../error-handling/errors/password-refused.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { $ts } from '../../localization/translate.function';
import { PASSWORD_MAX_LENGTH } from '../hash/hash.utilities';

/**
 * The most characters a password has when the password policy names no `maxLength`.
 */
export const DEFAULT_PASSWORD_MAX_LENGTH: number = 128;

/**
 * Checks passwords against the password policy, and the policy itself.
 */
export abstract class PasswordPolicyUtilities {
    /**
     * Validates that a policy can be met, and that a password it takes can be logged in with.
     * @param policy - The policy.
     * @throws When a length is no whole number, the shortest is longer than the longest, or the longest
     * is longer than a login takes.
     */
    static validatePolicy(policy: PasswordPolicy): void {
        const maxLength: number = this.getMaxLength(policy);
        if (!Number.isInteger(policy.minLength) || policy.minLength < 1) {
            throw new InternalError(
                `ZIBRI_DI_TOKENS.PASSWORD_POLICY: minLength must be a whole number of at least 1, got ${policy.minLength}.`
            );
        }
        // the body of a login takes no longer password, so a longer one could be set and never used
        if (!Number.isInteger(maxLength) || maxLength < policy.minLength || maxLength > PASSWORD_MAX_LENGTH) {
            throw new InternalError([
                `ZIBRI_DI_TOKENS.PASSWORD_POLICY: maxLength must be a whole number from minLength to ${PASSWORD_MAX_LENGTH},`,
                `got ${maxLength}.`
            ]);
        }
    }

    /**
     * Validates a password against a policy: its lengths first, then its own check.
     * @param password - The password, as it is written.
     * @param policy - The policy.
     * @throws PasswordRefusedError when it is shorter or longer than the policy says, and what the
     * policy's own check throws.
     */
    static async validatePassword(password: string, policy: PasswordPolicy): Promise<void> {
        // by code point, so a character outside the basic plane counts once, as a user typing it counts it
        const length: number = [...password].length;
        if (length < policy.minLength) {
            throw new PasswordRefusedError($ts`A password needs to be at least ${policy.minLength} characters long.`);
        }
        const maxLength: number = this.getMaxLength(policy);
        if (length > maxLength) {
            throw new PasswordRefusedError($ts`A password needs to be at most ${maxLength} characters long.`);
        }
        await policy.validatePassword?.(password);
    }

    private static getMaxLength(policy: PasswordPolicy): number {
        // what ASVS 2.1.2 asks: at least 64 taken, more than 128 refused. Room for a passphrase or what a
        // password manager generates, far from what a login takes
        return policy.maxLength ?? DEFAULT_PASSWORD_MAX_LENGTH;
    }
}