import { randomBytes } from 'node:crypto';

import { type EmailVerificationOptions } from './email-verification-options.model';
import { type EmailVerificationPurpose } from './email-verification-purpose.type';
import { type EmailVerificationServiceInterface } from './email-verification-service.interface';
import { EmailVerificationToken, EmailVerificationTokenCreateData } from './email-verification-token.model';
import { EmailVerificationWriteObserver } from './email-verification.write-observer';
import { ZibriApplication } from '../../application/application';
import { type AuditServiceInterface } from '../../audit/audit-service.interface';
import { Repository } from '../../data-source/repository/repository';
import { Transaction } from '../../data-source/transaction/transaction.model';
import { EntityWriteObserverRegistry } from '../../data-source/write-observers/entity-write-observer.registry';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { EmailPriority } from '../../email/models/email-priority.enum';
import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { EmailNotVerifiedError } from '../../error-handling/errors/email-not-verified.error';
import { UnauthorizedError } from '../../error-handling/errors/unauthorized.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { AfterAppInit } from '../../global/after-app-init.interface';
import { OnAppInit } from '../../global/on-app-init.interface';
import { $ts } from '../../localization/translate.function';
import { AuditAction, AuditOutcome } from '../../logging/audit-event.model';
import { AuditUtilities } from '../../logging/audit.utilities';
import { TsxUtilities } from '../../tsx/tsx.utilities';
import { Ms } from '../../utilities/ms';
import { validateEntitiesRegistered } from '../../utilities/validate-entities-registered.function';
import { Sha256HashStrategy } from '../hash/strategies/sha256.hash-strategy';
import { BaseUser } from '../models/base-user.model';
import { UserAccount } from '../models/user-account.model';

/**
 * How long a link works when the options say nothing.
 */
const DEFAULT_LINK_EXPIRES_IN_MS: number = Ms.DAY;

/**
 * Default implementation of the service that verifies the email addresses of users and changes them.
 */
@Injectable({ register: 'onUse' })
export class EmailVerificationService implements EmailVerificationServiceInterface, OnAppInit, AfterAppInit {
    private get options(): EmailVerificationOptions | undefined {
        return inject(ZIBRI_DI_TOKENS.EMAIL_VERIFICATION_OPTIONS);
    }

    // read when used rather than injected, so that an application verifying no addresses never needs
    // the entity
    private get tokenRepository(): Repository<EmailVerificationToken, EmailVerificationTokenCreateData> {
        return inject(repositoryTokenFor(EmailVerificationToken));
    }

    private get auditService(): AuditServiceInterface {
        return inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    get isEnabled(): boolean {
        return this.options != undefined;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    get isRequiredForLogin(): boolean {
        return this.options?.requiredForLogin === true;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        const options: EmailVerificationOptions | undefined = this.options;
        if (options == undefined) {
            return;
        }
        validateEntitiesRegistered(EmailVerificationService.name, app, EmailVerificationToken);
        if (!options.confirmEmailUrl) {
            throw new InternalError('ZIBRI_DI_TOKENS.EMAIL_VERIFICATION_OPTIONS names no confirmEmailUrl for its links to point to.');
        }
        if (options.linkExpiresInMs != undefined && !(options.linkExpiresInMs > 0)) {
            throw new InternalError(`EMAIL_VERIFICATION_OPTIONS.linkExpiresInMs must be greater than 0, got ${options.linkExpiresInMs}.`);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    afterAppInit(): void {
        // after init, once the user service has found the repositories of the users
        if (!this.isEnabled) {
            return;
        }
        for (const entityClass of inject(ZIBRI_DI_TOKENS.USER_SERVICE).getUserEntityClasses()) {
            inject(EntityWriteObserverRegistry).register(entityClass, new EmailVerificationWriteObserver());
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async requestEmailVerification(userId: string, transaction: Transaction | undefined): Promise<void> {
        const user: BaseUser<string> = await inject(ZIBRI_DI_TOKENS.USER_SERVICE).findById(userId, { transaction });
        // one live link at a time, as with a password reset: the earlier one is still in the inbox
        const live: EmailVerificationToken | undefined = await this.tokenRepository.findOne({
            where: { userId, purpose: 'verification', email: user.email, expirationDate: { after: new Date() } },
            transaction,
            required: false
        });
        if (live != undefined) {
            return;
        }
        await this.mailLink(user, user.email, 'verification', transaction);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async confirmEmailVerification(token: string, transaction: Transaction | undefined): Promise<void> {
        let userId: string | undefined = undefined;
        try {
            const found: EmailVerificationToken = await this.resolveToken(token, 'verification', transaction);
            userId = found.userId;
            const user: BaseUser<string> = await inject(ZIBRI_DI_TOKENS.USER_SERVICE).findById(found.userId, { transaction });
            await this.tokenRepository.deleteById(found.id, { transaction });
            // the address it was sent to, which a change since has replaced
            if (user.email !== found.email) {
                throw new UnauthorizedError($ts`Link invalid`);
            }
            await inject(ZIBRI_DI_TOKENS.USER_SERVICE).updateEmail(user.id, user.email, new Date(), transaction);
            this.auditService.record({ action: AuditAction.EMAIL_VERIFIED, outcome: AuditOutcome.SUCCESS, userId });
        }
        catch (error) {
            this.auditService.record({
                action: AuditAction.EMAIL_VERIFIED,
                outcome: AuditOutcome.FAILURE,
                reason: AuditUtilities.resolveReason(error),
                userId
            });
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async requestEmailChange(userId: string, newEmail: string, transaction: Transaction | undefined): Promise<void> {
        try {
            const user: BaseUser<string> = await inject(ZIBRI_DI_TOKENS.USER_SERVICE).findById(userId, { transaction });
            if (newEmail === user.email) {
                throw new BadRequestError($ts`This is the address of the account already.`);
            }
            // the link of an earlier change goes, so the address asked for last is the one that wins
            await this.tokenRepository.deleteAll({ userId, purpose: 'change' }, { transaction });
            await this.mailLink(user, newEmail, 'change', transaction);
            this.auditService.record({
                action: AuditAction.EMAIL_CHANGE_REQUESTED,
                outcome: AuditOutcome.SUCCESS,
                subject: newEmail,
                userId
            });
        }
        catch (error) {
            this.auditService.record({
                action: AuditAction.EMAIL_CHANGE_REQUESTED,
                outcome: AuditOutcome.FAILURE,
                reason: AuditUtilities.resolveReason(error),
                subject: newEmail,
                userId
            });
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async confirmEmailChange(token: string, transaction: Transaction | undefined): Promise<void> {
        let userId: string | undefined = undefined;
        try {
            const options: EmailVerificationOptions = this.getEnabledOptions();
            const found: EmailVerificationToken = await this.resolveToken(token, 'change', transaction);
            userId = found.userId;
            const user: BaseUser<string> = await inject(ZIBRI_DI_TOKENS.USER_SERVICE).findById(found.userId, { transaction });
            const previousEmail: string = user.email;
            // verified by the link that was followed to get here
            await inject(ZIBRI_DI_TOKENS.USER_SERVICE).updateEmail(user.id, found.email, new Date(), transaction);
            // every link of the user: a link to verify was for the previous address
            await this.tokenRepository.deleteAll({ userId: user.id }, { transaction });
            // the one who held the previous address learns of it, which is the warning of a change
            // somebody made with a session of theirs
            await inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE).queue({
                recipients: [previousEmail],
                subject: $ts`Your email address was changed`,
                html: TsxUtilities.renderEmail(
                    options.emailChangedEmail,
                    { previousEmail, newEmail: found.email, user: { ...user, email: found.email } }
                ),
                userId: user.id,
                priority: EmailPriority.HIGH
            });
            this.auditService.record({ action: AuditAction.EMAIL_CHANGED, outcome: AuditOutcome.SUCCESS, subject: found.email, userId });
        }
        catch (error) {
            this.auditService.record({
                action: AuditAction.EMAIL_CHANGED,
                outcome: AuditOutcome.FAILURE,
                reason: AuditUtilities.resolveReason(error),
                userId
            });
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    validateEmailVerified(user: UserAccount): void {
        if (this.isEnabled && user.emailVerifiedAt == undefined) {
            throw new EmailNotVerifiedError();
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteUserRows(userIds: string[], transaction: Transaction): Promise<void> {
        // only an application verifying addresses declares the entity
        if (!this.isEnabled) {
            return;
        }
        await this.tokenRepository.deleteAll({ userId: { oneOf: userIds } }, { transaction });
    }

    /**
     * Mails a user a link to verify an address.
     * @param user - The user.
     * @param email - The address verified, which the link is mailed to.
     * @param purpose - Whether it verifies the user's address or changes it to this one.
     * @param transaction - The transaction to write the token in, if any.
     */
    private async mailLink(
        user: UserAccount,
        email: string,
        purpose: EmailVerificationPurpose,
        transaction: Transaction | undefined
    ): Promise<void> {
        const options: EmailVerificationOptions = this.getEnabledOptions();
        // kept here, for the reason requestPasswordReset gives: the stored value is its hash
        const tokenValue: string = randomBytes(16).toString('hex');
        await this.tokenRepository.create({
            value: tokenValue,
            userId: user.id,
            email,
            purpose,
            expirationDate: new Date(Date.now() + (options.linkExpiresInMs ?? DEFAULT_LINK_EXPIRES_IN_MS))
        }, { transaction });
        await inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE).queue({
            recipients: [email],
            subject: purpose === 'change' ? $ts`Confirm your new email address` : $ts`Verify your email address`,
            html: TsxUtilities.renderEmail(
                options.verificationEmail,
                { link: `${options.confirmEmailUrl}/${tokenValue}`, email, purpose, user }
            ),
            userId: user.id,
            priority: EmailPriority.HIGH,
            // never kept, for the reason requestPasswordReset gives: the body carries the token
            persist: false
        });
    }

    /**
     * Resolves the stored token a link carries.
     * @param token - The token from the link.
     * @param purpose - What the link has to be for.
     * @param transaction - The transaction to read in, if any.
     * @returns The stored token.
     * @throws An UnauthorizedError when it is unknown, for something else, or has expired.
     */
    private async resolveToken(
        token: string,
        purpose: EmailVerificationPurpose,
        transaction: Transaction | undefined
    ): Promise<EmailVerificationToken> {
        this.getEnabledOptions();
        const value: string = await inject(ZIBRI_DI_TOKENS.HASH_SERVICE).hash(token, { strategy: Sha256HashStrategy });
        const found: EmailVerificationToken | undefined = await this.tokenRepository
            .findOne({ where: { value, purpose }, transaction, required: false });
        if (found == undefined) {
            throw new UnauthorizedError($ts`Link invalid`);
        }
        if (new Date(found.expirationDate).getTime() <= Date.now()) {
            await this.tokenRepository.deleteById(found.id, { transaction });
            throw new UnauthorizedError($ts`Link expired`);
        }
        return found;
    }

    /**
     * Gets the options, refusing an application that verifies no addresses.
     * @returns The options.
     * @throws An InternalError when `EMAIL_VERIFICATION_OPTIONS` is not provided.
     */
    private getEnabledOptions(): EmailVerificationOptions {
        const options: EmailVerificationOptions | undefined = this.options;
        if (options == undefined) {
            throw new InternalError('Addresses are verified once ZIBRI_DI_TOKENS.EMAIL_VERIFICATION_OPTIONS is provided, and it is not.');
        }
        return options;
    }
}