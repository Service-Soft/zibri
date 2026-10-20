import { randomBytes, timingSafeEqual } from 'crypto';

import { MailingListSubscriberCreateData, MailingListQueueEmailData, MailingListServiceInterface } from './mailing-list-service.interface.ts';
import { type AssetServiceInterface } from '../../../assets/asset-service.interface.ts';
import { type HashServiceInterface } from '../../../auth/hash/hash-service.interface.ts';
import { Sha256HashStrategy } from '../../../auth/hash/strategies/sha256.hash-strategy.ts';
import { Repository } from '../../../data-source/repository/repository.ts';
import { NoActiveTenantError } from '../../../data-source/tenancy/no-active-tenant.error.ts';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator.ts';
import { Inject } from '../../../di/decorators/inject.decorator.ts';
import { Injectable } from '../../../di/decorators/injectable.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../../di/inject.function.ts';
import { type EmailServiceInterface } from '../../../email/email-service.interface.ts';
import { EmailPriority } from '../../../email/models/email-priority.enum.ts';
import { NotFoundError } from '../../../error-handling/errors/not-found.error.ts';
import { UnauthorizedError } from '../../../error-handling/errors/unauthorized.error.ts';
import { InternalError } from '../../../error-handling/internal-error.model.ts';
import { GlobalRegistry } from '../../../global/global-registry.ts';
import { OnAppInit } from '../../../global/on-app-init.interface.ts';
import { $ts } from '../../../localization/translate.function.ts';
import { Route } from '../../../routing/controller-route-configuration.model.ts';
import { type TenantServiceInterface } from '../../../tenancy/tenant-service.interface.ts';
import { TsxUtilities } from '../../../tsx/tsx.utilities.ts';
import { OmitStrict } from '../../../types/omit-strict.type.ts';
import { PromiseUtilities } from '../../../utilities/promise.utilities.ts';
import { ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS } from '../mailing-list.tokens.ts';
import { type MailingListBaseEmailTemplate, MailingListTemplateData } from '../models/mailing-list-base-email-template.model.ts';
import { type MailingListSubscribeConfirmationEmailTemplate } from '../models/mailing-list-subscribe-confirmation-email-template.model.ts';
import { MailingListSubscriber } from '../models/mailing-list-subscriber.model.ts';
import { MailingListSubscriptionConfirmationToken, MailingListSubscriptionConfirmationTokenCreateData } from '../models/mailing-list-subscription-confirmation-token.model.ts';
import { MailingList } from '../models/mailing-list.model.ts';

/**
 * Default mailing list service implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class MailingListService implements MailingListServiceInterface, OnAppInit {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly mailingListBaseRoute: Route = '/mailing-lists';

    constructor(
        @Inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE)
        protected readonly emailService: EmailServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.ASSET_SERVICE)
        protected readonly assetService: AssetServiceInterface,
        @Inject(ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.CONFIRMATION_TOKEN_EXPIRES_IN_MS)
        protected readonly mailingListSubscriptionConfirmationTokenExpiresInMs: number,
        @Inject(ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.SUBSCRIBE_CONFIRMATION_EMAIL_TEMPLATE)
        protected readonly MailingListSubscribeConfirmationEmail: MailingListSubscribeConfirmationEmailTemplate,
        @Inject(ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.BASE_EMAIL_TEMPLATE)
        protected readonly MailingListBaseEmail: MailingListBaseEmailTemplate,
        @Inject(ZIBRI_DI_TOKENS.TENANT_SERVICE)
        protected readonly tenantService: TenantServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.HASH_SERVICE)
        protected readonly hashService: HashServiceInterface
    ) {}

    // the three below are read when used rather than injected: this is built at every boot that
    // uses the plugin, and ZibriMailingListPlugin.validate names the entities that are missing - which
    // it could not, if building this had failed on a repository token first

    /**
     * The repository of the mailing lists.
     * @returns The repository.
     */
    protected get mailingListRepository(): Repository<MailingList> {
        return inject(repositoryTokenFor(MailingList));
    }

    /**
     * The repository of the subscribers.
     * @returns The repository.
     */
    protected get subscriberRepository(): Repository<MailingListSubscriber, MailingListSubscriberCreateData> {
        return inject(repositoryTokenFor(MailingListSubscriber));
    }

    /**
     * The repository of the tokens a subscription is confirmed with.
     * @returns The repository.
     */
    protected get confirmationTokenRepository(): Repository<
        MailingListSubscriptionConfirmationToken,
        MailingListSubscriptionConfirmationTokenCreateData
    > {
        return inject(repositoryTokenFor(MailingListSubscriptionConfirmationToken));
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    onAppInit(): void {
        if (inject(ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.SUBSCRIBE_CONFIRMATION_EMAIL_TEMPLATE) == undefined) {
            throw new InternalError([
                'The builtin MailingListService requires that a value for',
                'ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.SUBSCRIBE_CONFIRMATION_EMAIL_TEMPLATE is provided.'
            ].join(' '));
        }
        if (inject(ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.BASE_EMAIL_TEMPLATE) == undefined) {
            throw new InternalError([
                'The builtin MailingListService requires that a value for',
                'ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.BASE_EMAIL_TEMPLATE is provided.'
            ].join(' '));
        }
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async resolveSubscribeConfirmationLink(listId: string, confirmationToken: string): Promise<string> {
        return await this.resolveLink(`${this.mailingListBaseRoute}/${listId}/subscribe/${confirmationToken}`);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async resolveUnsubscribeLink(listId: string, subscriber: MailingListSubscriber): Promise<string> {
        return await this.resolveLink(`${this.mailingListBaseRoute}/${listId}/unsubscribe?${this.getSubscriberQuery(subscriber)}`);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async resolveManagePreferencesLink(subscriber: MailingListSubscriber): Promise<string> {
        return await this.resolveLink(`${this.mailingListBaseRoute}/preferences?${this.getSubscriberQuery(subscriber)}`);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async resolveSubscriberOfLink(subscriberId: string, secret: string): Promise<MailingListSubscriber> {
        const found: MailingListSubscriber | undefined = await this.subscriberRepository.findOne(
            { where: { id: subscriberId }, relations: ['mailingLists'], required: false }
        );
        // an unknown id answers like a wrong secret, so a link tells nobody which ids are subscribers.
        // Compared as bytes, with the length checked first because timingSafeEqual throws on a
        // mismatch - the length of a secret this generates is no secret
        const stored: Buffer = Buffer.from(found?.secret ?? '');
        const presented: Buffer = Buffer.from(secret);
        if (found == undefined || stored.length !== presented.length || !timingSafeEqual(stored, presented)) {
            throw new UnauthorizedError($ts`Link invalid`);
        }
        return found;
    }

    /**
     * The query naming a subscriber in a link: their id, and the secret that proves the link was sent to them.
     * @param subscriber - The subscriber.
     * @returns The query, without the leading `?`.
     */
    protected getSubscriberQuery(subscriber: MailingListSubscriber): string {
        return new URLSearchParams({ subscriberId: subscriber.id, secret: subscriber.secret }).toString();
    }

    /**
     * Resolves a link to a route of the mailing lists, naming the active tenant the way its requests are
     * read: following a link sends no header.
     * @param path - The route, below the application's `baseUrl`.
     * @returns The link.
     * @throws A NoActiveTenantError when no tenant is active, whose mailing lists the link would be for.
     */
    protected async resolveLink(path: string): Promise<string> {
        const tenantId: string | undefined = this.tenantService.getActiveTenantId();
        if (tenantId == undefined) {
            throw new NoActiveTenantError(MailingList);
        }
        const baseUrl: string = GlobalRegistry.getAppData('baseUrl') ?? '';
        return await this.tenantService.resolveTenantUrl(`${baseUrl}${path}`, tenantId);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async queueEmailForList<T>(listId: string, data: MailingListQueueEmailData<T>): Promise<void> {
        const list: MailingList = await this.mailingListRepository.findById(listId, { relations: ['subscribers'] });
        await PromiseUtilities.allChunked(
            list.subscribers,
            async subscriber => {
                // resolved here rather than by the template, which renders without waiting for anything
                const templateData: MailingListTemplateData = {
                    subscriber,
                    list,
                    unsubscribeLink: await this.resolveUnsubscribeLink(list.id, subscriber),
                    managePreferencesLink: await this.resolveManagePreferencesLink(subscriber)
                };
                const content: string = await data.compile(data.template, templateData);

                const html: string = TsxUtilities.renderEmail(
                    this.MailingListBaseEmail,
                    {
                        ...templateData,
                        html: content,
                        title: data.title ?? data.subject
                    }
                );

                await this.emailService.queue({
                    html,
                    priority: EmailPriority.LOW,
                    recipients: [subscriber.email],
                    persist: false,
                    listUnsubscribeUrl: templateData.unsubscribeLink,
                    ...data
                });
            }
        );
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async requestSubscribeToList<T>(
        listId: string,
        subscriber: MailingListSubscriberCreateData,
        emailData: OmitStrict<MailingListQueueEmailData<T>, 'template' | 'compile'>
    ): Promise<void> {
        const list: MailingList = await this.mailingListRepository.findById(listId);
        const foundSubscriber: MailingListSubscriber | undefined = await this.subscriberRepository.findOne(
            { where: { email: subscriber.email }, relations: ['mailingLists'], required: false }
        );
        // an address the application knows confirms like any other: knowing it is no consent to a
        // list it never asked for. One already on this list has nothing to confirm, and the caller
        // learns which it was from neither
        if (foundSubscriber?.mailingLists.some(l => l.id === listId) === true) {
            return;
        }

        // the token exists in the clear only here and in the mail: the stored row holds it hashed
        const tokenValue: string = randomBytes(16).toString('hex');
        await this.confirmationTokenRepository.create({
            email: subscriber.email,
            value: tokenValue,
            expirationDate: new Date(Date.now() + this.mailingListSubscriptionConfirmationTokenExpiresInMs),
            name: subscriber.name,
            listId,
            spent: false
        });

        const html: string = TsxUtilities.renderEmail(
            this.MailingListSubscribeConfirmationEmail,
            {
                subscriber,
                mailingList: list,
                confirmEmailLink: await this.resolveSubscribeConfirmationLink(listId, tokenValue)
            }
        );

        // persist after the spread, so an application cannot ask for this one to be kept: a copy of
        // the mail is a copy of the token in the clear, outliving the send
        await this.emailService.queue({ ...emailData, html, recipients: [subscriber.email], persist: false });
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async confirmSubscribeToList(listId: string, confirmationTokenValue: string): Promise<MailingListSubscriber> {
        // the list is part of the lookup, so the list a link names is the one it subscribes to
        const foundToken: MailingListSubscriptionConfirmationToken | undefined = await this.confirmationTokenRepository.findOne({
            where: { value: await this.hashService.hash(confirmationTokenValue, { strategy: Sha256HashStrategy }), listId },
            required: false
        });
        if (foundToken == undefined) {
            throw new UnauthorizedError($ts`Link invalid`);
        }
        if (new Date(foundToken.expirationDate).getTime() <= Date.now()) {
            throw new UnauthorizedError($ts`Link expired`);
        }
        const mailingList: MailingList = await this.mailingListRepository.findById(listId);
        const foundSubscriber: MailingListSubscriber | undefined = await this.subscriberRepository.findOne(
            { where: { email: foundToken.email }, relations: ['mailingLists'], required: false }
        );
        const subscribed: boolean = foundSubscriber?.mailingLists.some(l => l.id === listId) === true;

        if (foundToken.spent) {
            // followed again, often by a mail scanner before the person themselves: what it confirmed
            // still holds, so it answers like it did, but it never writes again - an address that
            // left the list since is not put back by an old mail
            if (foundSubscriber == undefined || !subscribed) {
                throw new UnauthorizedError($ts`Link invalid`);
            }
            return foundSubscriber;
        }
        await this.spendToken(foundToken);

        if (foundSubscriber == undefined) {
            return await this.subscriberRepository.create({ email: foundToken.email, name: foundToken.name, mailingLists: [mailingList] });
        }
        if (subscribed) {
            return foundSubscriber;
        }
        return await this.subscriberRepository.updateById(
            foundSubscriber.id,
            { mailingLists: [...foundSubscriber.mailingLists, mailingList] }
        );
    }

    /**
     * Marks a confirmation token as spent, if nobody else did first.
     * @param token - The token, as it was read while it was not spent.
     * @throws An UnauthorizedError when it was spent meanwhile.
     */
    protected async spendToken(token: MailingListSubscriptionConfirmationToken): Promise<void> {
        // the read before takes no lock, so two requests following the same link both get this far -
        // the condition on the write decides between them. Spent before the subscription is written
        // rather than with it: the token's data source need not be the subscribers', so there is no
        // transaction holding both, and a write that fails after this leaves a link that has to be
        // requested again instead of an address subscribed twice
        try {
            await this.confirmationTokenRepository.updateById(token.id, { spent: true }, { where: { spent: false } });
        }
        catch (error) {
            if (!(error instanceof NotFoundError)) {
                throw error;
            }
            throw new UnauthorizedError($ts`Link invalid`, { cause: error });
        }
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async unsubscribeFromList(listId: string, subscriberId: string): Promise<void> {
        await this.mailingListRepository.findById(listId);
        const foundSubscriber: MailingListSubscriber = await this.subscriberRepository.findOne(
            { where: { id: subscriberId }, relations: ['mailingLists'] }
        );
        if (!foundSubscriber.mailingLists.find(l => l.id === listId)) {
            // Is not subscribed to the mailing list.
            return;
        }
        const newMailingLists: MailingList[] = foundSubscriber.mailingLists.filter(l => l.id !== listId);
        await this.subscriberRepository.updateById(subscriberId, { mailingLists: newMailingLists });
    }
}