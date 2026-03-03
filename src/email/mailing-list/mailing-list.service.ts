import { randomBytes } from 'crypto';

import { MailingListSubscriberCreateData, MailingListQueueEmailData, MailingListServiceInterface, BaseMailingListEmailTemplateData } from './mailing-list-service.interface';
import { AssetServiceInterface } from '../../assets';
import { Repository } from '../../data-source';
import { inject, repositoryTokenFor, ZIBRI_DI_TOKENS } from '../../di';
import { GlobalRegistry } from '../../global';
import { BaseEmailTemplateData, renderTemplate, renderTemplateString } from '../../handlebars';
import { Route } from '../../routing';
import { EmailServiceInterface } from '../email-service.interface';
import { MailingList, MailingListSubscriber, MailingListSubscriptionConfirmationToken, MailingListSubscriptionConfirmationTokenCreateData } from './models';
import { FsUtilities, Path, PromiseUtilities, validateEntitiesRegistered } from '../../utilities';
import { EmailPriority } from '../models';

/**
 * Default mailing list service implementation of Zibri.
 */
export class MailingListService implements MailingListServiceInterface {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly mailingListBaseRoute: Route = '/mailing-lists';
    /**
     * The email service.
     */
    protected readonly emailService: EmailServiceInterface;
    /**
     * The asset service.
     */
    protected readonly assetService: AssetServiceInterface;
    /**
     * The time in ms after which the token to confirm a new mailing list subscription expires.
     */
    protected readonly mailingListSubscriptionConfirmationTokenExpiresInMs: number;

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected get mailingListRepository(): Repository<MailingList> {
        return inject(repositoryTokenFor(MailingList));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected get subscriberRepository(): Repository<MailingListSubscriber, MailingListSubscriberCreateData> {
        return inject(repositoryTokenFor(MailingListSubscriber));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected get confirmationTokenRepository(): Repository<
        MailingListSubscriptionConfirmationToken,
        MailingListSubscriptionConfirmationTokenCreateData
    > {
        return inject(repositoryTokenFor(MailingListSubscriptionConfirmationToken));
    }

    constructor() {
        this.emailService = inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE);
        this.assetService = inject(ZIBRI_DI_TOKENS.ASSET_SERVICE);
        this.mailingListSubscriptionConfirmationTokenExpiresInMs = inject(
            ZIBRI_DI_TOKENS.MAILING_LIST_SUBSCRIPTION_CONFIRMATION_TOKEN_EXPIRES_IN_MS
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    attachTo(): void {
        validateEntitiesRegistered(this.constructor.name, MailingList, MailingListSubscriber, MailingListSubscriptionConfirmationToken);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async queueEmailForList<T extends BaseMailingListEmailTemplateData>(listId: string, data: MailingListQueueEmailData<T>): Promise<void> {
        const list: MailingList = await this.mailingListRepository.findById(listId);
        await PromiseUtilities.allChunked(
            list.subscribers,
            async s => {
                const base: BaseEmailTemplateData['base'] = {
                    ...data.templateData.base,
                    baseUrl: GlobalRegistry.getAppData('baseUrl') ?? '',
                    mailingListData: {
                        list,
                        subscriber: s,
                        mailingListBaseRoute: this.mailingListBaseRoute
                    }
                };
                const content: string = renderTemplateString(data.templateString, {
                    ...data.templateData,
                    base
                });
                const html: string = await renderTemplate(
                    FsUtilities.getPath(this.assetService.emailTemplatePath, 'base-email.hbs') as `${Path}.hbs`,
                    { content, base }
                );
                await this.emailService.queue({
                    html,
                    priority: EmailPriority.LOW,
                    recipients: [s.email],
                    persist: false,
                    ...data
                });
            }
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async requestSubscribeToList<T extends BaseMailingListEmailTemplateData>(
        listId: string,
        subscriber: MailingListSubscriberCreateData,
        emailData: MailingListQueueEmailData<T>
    ): Promise<void> {

        const foundSubscriber: MailingListSubscriber | undefined = await this.subscriberRepository.findOne(
            { where: { email: subscriber.email } },
            false
        );
        if (foundSubscriber) {
            const list: MailingList = await this.mailingListRepository.findById(listId);
            await this.subscriberRepository.updateById(foundSubscriber.id, { mailingLists: [...foundSubscriber.mailingLists, list] });
            return;
        }

        await this.confirmationTokenRepository.create({
            email: subscriber.email,
            value: randomBytes(16).toString('hex'),
            expirationDate: new Date(Date.now() + this.mailingListSubscriptionConfirmationTokenExpiresInMs),
            name: subscriber.name,
            listId
        });

        const content: string = renderTemplateString(emailData.templateString, {
            ...emailData.templateData,
            base: emailData.templateData.base
        });
        const html: string = await renderTemplate(
            FsUtilities.getPath(this.assetService.emailTemplatePath, 'base-email.hbs') as `${Path}.hbs`,
            { content, base: emailData.templateData.base }
        );
        await this.emailService.queue({ ...emailData, html, recipients: [subscriber.email] });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async confirmSubscribeToList(confirmationTokenValue: string): Promise<void> {
        const foundToken: MailingListSubscriptionConfirmationToken = await this.confirmationTokenRepository.findOne(
            { where: { value: confirmationTokenValue } }
        );
        const mailingList: MailingList = await this.mailingListRepository.findById(foundToken.listId);
        const foundSubscriber: MailingListSubscriber | undefined = await this.subscriberRepository.findOne(
            { where: { email: foundToken.email }, relations: ['mailingLists'] },
            false
        );
        if (!foundSubscriber) {
            await this.subscriberRepository.create({ email: foundToken.email, name: foundToken.name, mailingLists: [mailingList] });
            return;
        }
        if (foundSubscriber.mailingLists.find(l => l.id === mailingList.id)) {
            // already subscribed, do nothing
            return;
        }
        await this.subscriberRepository.updateById(foundSubscriber.id, { mailingLists: [...foundSubscriber.mailingLists, mailingList] });
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