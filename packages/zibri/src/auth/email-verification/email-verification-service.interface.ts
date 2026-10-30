import { Transaction } from '../../data-source/transaction/transaction.model';
import { UserAccount } from '../models/user-account.model';

/**
 * Interface for the service that verifies the email addresses of users and changes them.
 */
export interface EmailVerificationServiceInterface {
    /**
     * Whether addresses are verified: `ZIBRI_DI_TOKENS.EMAIL_VERIFICATION_OPTIONS` is provided.
     */
    readonly isEnabled: boolean,
    /**
     * Whether a password login waits until the user's address is verified.
     */
    readonly isRequiredForLogin: boolean,
    /**
     * Mails a user a link to verify the address they have. Does nothing while an earlier link of
     * theirs still works.
     */
    requestEmailVerification: (userId: string, transaction: Transaction | undefined) => Promise<void>,
    /**
     * Verifies the address a link was sent to, by the token it carries.
     * @throws An UnauthorizedError when the token is unknown, has expired, or the user's address is no
     * longer the one it was sent to.
     */
    confirmEmailVerification: (token: string, transaction: Transaction | undefined) => Promise<void>,
    /**
     * Mails a user a link to the address they want to change to, which changes it once followed.
     */
    requestEmailChange: (userId: string, newEmail: string, transaction: Transaction | undefined) => Promise<void>,
    /**
     * Changes the address of a user to the one a link was sent to, by the token it carries, verified,
     * and tells the previous address.
     * @throws An UnauthorizedError when the token is unknown or has expired.
     */
    confirmEmailChange: (token: string, transaction: Transaction | undefined) => Promise<void>,
    /**
     * Refuses a user whose address is not verified, while addresses are verified.
     * @throws An EmailNotVerifiedError when it is not.
     */
    validateEmailVerified: (user: UserAccount) => void,
    /**
     * Deletes the links of the given users. Called in the transaction that deletes the users.
     */
    deleteUserRows: (userIds: string[], transaction: Transaction) => Promise<void>
}