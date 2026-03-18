import { randomBytes } from 'crypto';

import { MailingListSubscriberCreateData, MailingListQueueEmailData, MailingListServiceInterface, BaseMailingListEmailTemplateData } from './mailing-list-service.interface';
import { type AssetServiceInterface } from '../../assets/asset-service.interface';
import { Repository } from '../../data-source/repository';
import { InjectRepository } from '../../di/decorators/inject-repository.decorator';
import { Inject } from '../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { GlobalRegistry } from '../../global/global-registry';
import { BaseEmailTemplateData, renderTemplateString, renderTemplate } from '../../handlebars/render-template.function';
import { Route } from '../../routing/controller-route-configuration.model';
import { FsUtilities, FsPath } from '../../utilities/fs.utilities';
import { PromiseUtilities } from '../../utilities/promise.utilities';
import { type EmailServiceInterface } from '../email-service.interface';
import { EmailPriority } from '../models/email-priority.enum';
import { MailingListSubscriber } from './models/mailing-list-subscriber.model';
import { MailingListSubscriptionConfirmationToken, MailingListSubscriptionConfirmationTokenCreateData } from './models/mailing-list-subscription-confirmation-token.model';
import { MailingList } from './models/mailing-list.model';
import { Injectable } from '../../di/decorators/injectable.decorator';

/**
 * Default mailing list service implementation of Zibri.
 */
@Injectable()
export class MailingListService implements MailingListServiceInterface {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly mailingListBaseRoute: Route = '/mailing-lists';

    constructor(
        @Inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE)
        protected readonly emailService: EmailServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.ASSET_SERVICE)
        protected readonly assetService: AssetServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.MAILING_LIST_SUBSCRIPTION_CONFIRMATION_TOKEN_EXPIRES_IN_MS)
        protected readonly mailingListSubscriptionConfirmationTokenExpiresInMs: number,
        @InjectRepository(MailingList)
        protected readonly mailingListRepository: Repository<MailingList>,
        @InjectRepository(MailingListSubscriber)
        protected readonly subscriberRepository: Repository<MailingListSubscriber, MailingListSubscriberCreateData>,
        @InjectRepository(MailingListSubscriptionConfirmationToken)
        protected readonly confirmationTokenRepository: Repository<
            MailingListSubscriptionConfirmationToken,
            MailingListSubscriptionConfirmationTokenCreateData
        >
    ) {}

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
                    FsUtilities.getPath(this.assetService.emailTemplatePath, 'base-email.hbs') as `${FsPath}.hbs`,
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
            FsUtilities.getPath(this.assetService.emailTemplatePath, 'base-email.hbs') as `${FsPath}.hbs`,
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