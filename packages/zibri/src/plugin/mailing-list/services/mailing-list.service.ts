import { randomBytes } from 'crypto';

import { MailingListSubscriberCreateData, MailingListQueueEmailData, MailingListServiceInterface } from './mailing-list-service.interface';
import { type AssetServiceInterface } from '../../../assets/asset-service.interface';
import { Repository } from '../../../data-source/repository/repository';
import { NoActiveTenantError } from '../../../data-source/tenancy/no-active-tenant.error';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { type EmailServiceInterface } from '../../../email/email-service.interface';
import { EmailPriority } from '../../../email/models/email-priority.enum';
import { InternalError } from '../../../error-handling/internal-error.model';
import { GlobalRegistry } from '../../../global/global-registry';
import { OnAppInit } from '../../../global/on-app-init.interface';
import { Route } from '../../../routing/controller-route-configuration.model';
import { type TenantServiceInterface } from '../../../tenancy/tenant-service.interface';
import { TsxUtilities } from '../../../tsx/tsx.utilities';
import { OmitStrict } from '../../../types/omit-strict.type';
import { PromiseUtilities } from '../../../utilities/promise.utilities';
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
    // eslint-disable-next-line jsdoc/require-jsdoc
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
        protected readonly tenantService: TenantServiceInterface
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

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveSubscribeConfirmationLink(listId: string, confirmationToken: string): Promise<string> {
        return await this.resolveLink(`${this.mailingListBaseRoute}/${listId}/subscribe/${confirmationToken}`);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveUnsubscribeLink(listId: string, subscriberId: string): Promise<string> {
        return await this.resolveLink(`${this.mailingListBaseRoute}/${listId}/unsubscribe?subscriberId=${subscriberId}`);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveManagePreferencesLink(subscriberId: string): Promise<string> {
        return await this.resolveLink(`${this.mailingListBaseRoute}/preferences?subscriberId=${subscriberId}`);
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
                    unsubscribeLink: await this.resolveUnsubscribeLink(list.id, subscriber.id),
                    managePreferencesLink: await this.resolveManagePreferencesLink(subscriber.id)
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
                    ...data
                });
            }
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async requestSubscribeToList<T>(
        listId: string,
        subscriber: MailingListSubscriberCreateData,
        emailData: OmitStrict<MailingListQueueEmailData<T>, 'template' | 'compile'>
    ): Promise<void> {

        const foundSubscriber: MailingListSubscriber | undefined = await this.subscriberRepository.findOne(
            { where: { email: subscriber.email }, relations: ['mailingLists'], required: false }
        );
        const list: MailingList = await this.mailingListRepository.findById(listId);
        if (foundSubscriber) {
            await this.subscriberRepository.updateById(foundSubscriber.id, { mailingLists: [...foundSubscriber.mailingLists, list] });
            return;
        }

        const token: MailingListSubscriptionConfirmationToken = await this.confirmationTokenRepository.create({
            email: subscriber.email,
            value: randomBytes(16).toString('hex'),
            expirationDate: new Date(Date.now() + this.mailingListSubscriptionConfirmationTokenExpiresInMs),
            name: subscriber.name,
            listId
        });

        const html: string = TsxUtilities.renderEmail(
            this.MailingListSubscribeConfirmationEmail,
            {
                subscriber,
                mailingList: list,
                confirmEmailLink: await this.resolveSubscribeConfirmationLink(listId, token.value)
            }
        );

        await this.emailService.queue({ ...emailData, html, recipients: [subscriber.email] });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async confirmSubscribeToList(confirmationTokenValue: string): Promise<MailingListSubscriber> {
        const foundToken: MailingListSubscriptionConfirmationToken = await this.confirmationTokenRepository.findOne(
            { where: { value: confirmationTokenValue } }
        );
        const mailingList: MailingList = await this.mailingListRepository.findById(foundToken.listId);
        const foundSubscriber: MailingListSubscriber | undefined = await this.subscriberRepository.findOne(
            { where: { email: foundToken.email }, relations: ['mailingLists'], required: false }
        );
        if (!foundSubscriber) {
            return await this.subscriberRepository.create({ email: foundToken.email, name: foundToken.name, mailingLists: [mailingList] });
        }
        if (foundSubscriber.mailingLists.find(l => l.id === mailingList.id)) {
            // already subscribed, do nothing
            return foundSubscriber;
        }
        return await this.subscriberRepository.updateById(
            foundSubscriber.id,
            { mailingLists: [...foundSubscriber.mailingLists, mailingList] }
        );
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
        const newMailingLists: MailingList[] = foundSubscriber.mailingLists.filter(l => l.id !== listId);
        await this.subscriberRepository.updateById(subscriberId, { mailingLists: newMailingLists });
    }
}