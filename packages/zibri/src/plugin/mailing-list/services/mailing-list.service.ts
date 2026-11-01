import { randomBytes, timingSafeEqual } from 'crypto';

import { MailingListSubscriberCreateData, MailingListQueueEmailData, MailingListServiceInterface } from './mailing-list-service.interface';
import { ZibriApplication } from '../../../application/application';
import { type AssetServiceInterface } from '../../../assets/asset-service.interface';
import { type HashServiceInterface } from '../../../auth/hash/hash-service.interface';
import { Sha256HashStrategy } from '../../../auth/hash/strategies/sha256.hash-strategy';
import { Repository } from '../../../data-source/repository/repository';
import { NoActiveTenantError } from '../../../data-source/tenancy/no-active-tenant.error';
import { Transaction } from '../../../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { type EmailServiceInterface } from '../../../email/email-service.interface';
import { EmailPriority } from '../../../email/models/email-priority.enum';
import { NotFoundError } from '../../../error-handling/errors/not-found.error';
import { UnauthorizedError } from '../../../error-handling/errors/unauthorized.error';
import { InternalError } from '../../../error-handling/internal-error.model';
import { OnAppInit } from '../../../global/on-app-init.interface';
import { $ts } from '../../../localization/translate.function';
import { ControllerUtilities } from '../../../routing/controller.utilities';
import { type TenantServiceInterface } from '../../../tenancy/tenant-service.interface';
import { TsxUtilities } from '../../../tsx/tsx.utilities';
import { Newable } from '../../../types/newable.type';
import { OmitStrict } from '../../../types/omit-strict.type';
import { PromiseUtilities } from '../../../utilities/promise.utilities';
import { MailingListController } from '../mailing-list.controller';
import { ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS } from '../mailing-list.tokens';
import { type MailingListBaseEmailTemplate, MailingListTemplateData } from '../models/mailing-list-base-email-template.model';
import { type MailingListSubscribeConfirmationEmailTemplate } from '../models/mailing-list-subscribe-confirmation-email-template.model';
import { MailingListSubscriber } from '../models/mailing-list-subscriber.model';
import { MailingListSubscriptionConfirmationToken, MailingListSubscriptionConfirmationTokenCreateData } from '../models/mailing-list-subscription-confirmation-token.model';
import { MailingList } from '../models/mailing-list.model';

/**
 * Default mailing list service implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class MailingListService implements MailingListServiceInterface, OnAppInit {
    // the declared controller extending MailingListController, found while the application starts
    private routesController: Newable<unknown> | undefined;

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
        protected readonly hashService: HashServiceInterface,
        @Inject(ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.PAGES_URL)
        protected readonly pagesUrl: string | undefined
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

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        // none is no mistake yet: a subclass resolving links of its own needs none, and building a
        // link says so when it is missing
        this.routesController = app.options.controllers.find(c => c.prototype instanceof MailingListController);
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

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveSubscribeConfirmationLink(listId: string, confirmationToken: string): Promise<string> {
        return await this.resolveLink(`${this.resolvePagesUrl()}/${listId}/subscribe/${confirmationToken}`);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveUnsubscribeLink(listId: string, subscriber: MailingListSubscriber): Promise<string> {
        return await this.resolveLink(`${this.resolvePagesUrl()}/${listId}/unsubscribe?${this.getSubscriberQuery(subscriber)}`);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveOneClickUnsubscribeLink(listId: string, subscriber: MailingListSubscriber): Promise<string> {
        return await this.resolveLink(`${this.resolveControllerUrl()}/${listId}/unsubscribe?${this.getSubscriberQuery(subscriber)}`);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveManagePreferencesLink(subscriber: MailingListSubscriber): Promise<string> {
        return await this.resolveLink(`${this.resolvePagesUrl()}/preferences?${this.getSubscriberQuery(subscriber)}`);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
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
     * Resolves a link of the mailing lists, naming the active tenant the way its requests are read:
     * following a link sends no header.
     * @param url - The link, without the tenant.
     * @returns The link.
     * @throws A NoActiveTenantError when no tenant is active, whose mailing lists the link would be for.
     */
    protected async resolveLink(url: string): Promise<string> {
        const tenantId: string | undefined = this.tenantService.getActiveTenantId();
        if (tenantId == undefined) {
            throw new NoActiveTenantError(MailingList);
        }
        return await this.tenantService.resolveTenantUrl(url, tenantId);
    }

    /**
     * Resolves where the pages the links of the emails open are: `PAGES_URL`, or the path of the
     * controller extending `MailingListController` when that is not set.
     * @returns The url, without a trailing slash.
     * @throws An InternalError when neither is there.
     */
    protected resolvePagesUrl(): string {
        return this.pagesUrl == undefined ? this.resolveControllerUrl() : this.pagesUrl.replace(/\/+$/, '');
    }

    /**
     * Resolves where the routes of the controller extending `MailingListController` answer.
     * @returns The url, without a trailing slash.
     * @throws An InternalError when the application declares no such controller.
     */
    protected resolveControllerUrl(): string {
        if (this.routesController == undefined) {
            throw new InternalError([
                `${this.constructor.name} links to the routes of the mailing lists, and found no controller extending`,
                'MailingListController to serve them while the application started.',
                'Declare one, or override the methods resolving the links to name routes of your own.'
            ]);
        }
        return ControllerUtilities.resolveUrl(this.routesController);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
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
                    listUnsubscribeUrl: await this.resolveOneClickUnsubscribeLink(list.id, subscriber),
                    ...data
                });
            }
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async requestSubscription<T>(
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

    // eslint-disable-next-line jsdoc/require-jsdoc
    async confirmSubscription(listId: string, confirmationTokenValue: string): Promise<MailingListSubscriber> {
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

    // eslint-disable-next-line jsdoc/require-jsdoc
    async unsubscribeFromList(listId: string, subscriberId: string): Promise<void> {
        await this.mailingListRepository.findById(listId);
        const foundSubscriber: MailingListSubscriber = await this.subscriberRepository.findOne(
            { where: { id: subscriberId }, relations: ['mailingLists'] }
        );
        if (!foundSubscriber.mailingLists.find(l => l.id === listId)) {
            // Is not subscribed to the mailing list.
            return;
        }
        await this.updateSubscriptions(subscriberId, foundSubscriber.mailingLists.filter(l => l.id !== listId).map(l => l.id));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateSubscriptions(subscriberId: string, mailingListIds: string[]): Promise<void> {
        const mailingLists: MailingList[] = mailingListIds.length
            ? await this.mailingListRepository.findAll({ where: { id: { oneOf: mailingListIds } }, limit: 'all' })
            : [];
        // an address is kept only while it is on a list: on none, nothing is left it consented to
        if (!mailingLists.length) {
            await this.subscriberRepository.deleteById(subscriberId);
            return;
        }
        await this.subscriberRepository.updateById(subscriberId, { mailingLists });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteList(listId: string): Promise<void> {
        const list: MailingList = await this.mailingListRepository.findById(listId, { relations: ['subscribers'] });
        const subscribers: MailingListSubscriber[] = list.subscribers.length
            ? await this.subscriberRepository.findAll({
                where: { id: { oneOf: list.subscribers.map(s => s.id) } },
                relations: ['mailingLists'],
                limit: 'all'
            })
            : [];
        const lastListOf: string[] = subscribers.filter(s => s.mailingLists.every(l => l.id === listId)).map(s => s.id);

        // in one transaction, so a list is never gone while the addresses only it held stay
        const transaction: Transaction = await this.mailingListRepository.dataSource.startTransaction();
        try {
            if (lastListOf.length) {
                await this.subscriberRepository.deleteAll({ id: { oneOf: lastListOf } }, { transaction });
            }
            await this.mailingListRepository.deleteById(listId, { transaction });
            await transaction.commit();
        }
        catch (error) {
            await transaction.rollback();
            throw error;
        }
    }
}