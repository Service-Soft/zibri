import { type RepositoryTransaction } from '../../data-source/transaction/repository-transaction.type';
import { UserAccount } from '../models/user-account.model';
import { EmailConfirmation } from './email-confirmation.model';

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
    requestEmailVerification: (userId: string, transaction: RepositoryTransaction | undefined) => Promise<void>,
    /**
     * Verifies the address a link was sent to, by the token it carries.
     * @throws An UnauthorizedError when the token is unknown, has expired, or the user's address is no
     * longer the one it was sent to.
     */
    confirmEmailVerification: (token: string, transaction: RepositoryTransaction | undefined) => Promise<void>,
    /**
     * Mails a user a link to the address they want to change to, which changes it once followed. With
     * `previousAddressConfirms`, mails the previous address a link to approve it as well, and the
     * change waits for both.
     */
    requestEmailChange: (userId: string, newEmail: string, transaction: RepositoryTransaction | undefined) => Promise<void>,
    /**
     * Changes the address of a user to the one a link was sent to, by the token it carries, verified,
     * and tells the previous address. Takes the link that approves a change as well; a change that
     * waits for the other link is kept until it is followed.
     * @throws An UnauthorizedError when the token is unknown or has expired.
     */
    confirmEmailChange: (token: string, transaction: RepositoryTransaction | undefined) => Promise<void>,
    /**
     * Confirms whatever a link is for, by the token it carries: verifies an address, or confirms a
     * link of a change, as confirmEmailVerification and confirmEmailChange do. For the one page every
     * link opens.
     * @returns What the link was for, and whether that is done.
     * @throws An UnauthorizedError when the token is unknown or has expired.
     */
    // TODO 4.0: required. Optional in 3.x, so that a service of an application's own keeps compiling
    confirmEmail?: (token: string, transaction: RepositoryTransaction | undefined) => Promise<EmailConfirmation>,
    /**
     * Refuses a user whose address is not verified, while addresses are verified.
     * @throws An EmailNotVerifiedError when it is not.
     */
    validateEmailVerified: (user: UserAccount) => void,
    /**
     * Deletes the links of the given users. Called in the transaction that deletes the users.
     */
    deleteUserRows: (userIds: string[], transaction: RepositoryTransaction) => Promise<void>
}