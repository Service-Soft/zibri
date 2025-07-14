import { randomBytes } from 'crypto';
import path from 'path';

import handlebars from 'handlebars';

import { MailingListSubscriberCreateData, MailingListQueueEmailData, MailingListServiceInterface, BaseMailingListEmailTemplateData } from './mailing-list-service.interface';
import { ZibriApplication } from '../../application';
import { AssetServiceInterface } from '../../assets';
import { BaseDataSource, Repository } from '../../data-source';
import { inject, repositoryTokenFor, ZIBRI_DI_TOKENS } from '../../di';
import { BaseEntity } from '../../entity';
import { GlobalRegistry } from '../../global';
import { BaseEmailTemplateData, renderPageTemplate, renderTemplate, renderTemplateString } from '../../handlebars';
import { HttpMethod } from '../../http';
import { Route } from '../../routing';
import { EmailServiceInterface } from '../email-service.interface';
import { MailingList, MailingListSubscriber, MailingListSubscriptionConfirmationToken, MailingListSubscriptionConfirmationTokenCreateData, UpdateMailingListPreferences } from './models';
import { HtmlResponse } from '../../parsing';
import { Newable } from '../../types';
import { chunkedPromiseAll } from '../../utilities';
import { EmailPriority } from '../models';

const INITIALIZE_ERROR_MESSAGE: string = 'Error initializing MailingListService.';
const INITIALIZE_ERROR_QUESTION: string = [
    'Did you forget to add it to your data source entities array?\n',
    'If you don\'t want to use the mailing list service you can also provide an undefined value for the token',
    'ZIBRI_DI_TOKENS.MAILING_LIST_SERVICE'
].join('\n');

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

    constructor() {
        this.emailService = inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE);
        this.assetService = inject(ZIBRI_DI_TOKENS.ASSET_SERVICE);
        this.mailingListSubscriptionConfirmationTokenExpiresInMs = inject(
            ZIBRI_DI_TOKENS.MAILING_LIST_SUBSCRIPTION_CONFIRMATION_TOKEN_EXPIRES_IN_MS
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    attachTo(app: ZibriApplication): void {
        this.validate();
        this.registerRoutes(app);
    }

    private registerRoutes(app: ZibriApplication): void {
        app.router.register({
            httpMethod: HttpMethod.GET,
            route: `${this.mailingListBaseRoute}/:id/unsubscribe`,
            pathParams: {
                id: { type: 'string', format: 'uuid' }
            },
            queryParams: {
                subscriberId: { type: 'string', format: 'uuid' }
            },
            handler: async (req) => {
                const mailingList: MailingList = await this.mailingListRepository.findById(req.params.id);
                const subscriber: MailingListSubscriber = await this.subscriberRepository.findById(req.query.subscriberId);
                await this.unsubscribeFromList(req.params.id, req.query.subscriberId);
                const html: string = await renderPageTemplate(
                    'mailing-list-unsubscribe.hbs',
                    {
                        base: { title: 'Unsubscribe' },
                        mailingList,
                        subscriber
                    }
                );
                return HtmlResponse.fromString(html);
            }
        });
        app.router.register({
            httpMethod: HttpMethod.GET,
            route: `${this.mailingListBaseRoute}/preferences`,
            queryParams: {
                subscriberId: { type: 'string', format: 'uuid' }
            },
            handler: async (req) => {
                const subscriber: MailingListSubscriber = await this.subscriberRepository.findById(
                    req.query.subscriberId,
                    { relations: ['mailingLists'] }
                );
                const mailingLists: MailingList[] = await this.mailingListRepository.findAll();
                const html: string = await renderPageTemplate(
                    'mailing-list-preferences.hbs',
                    {
                        base: { title: 'Preferences' },
                        mailingListBaseRoute: this.mailingListBaseRoute,
                        mailingLists: mailingLists.map(l => (
                            {
                                data: l,
                                isSubscribedTo: subscriber.mailingLists.find(sl => sl.id === l.id)
                            }
                        )),
                        subscriber
                    }
                );
                return HtmlResponse.fromString(html);
            }
        });
        app.router.register({
            httpMethod: HttpMethod.PATCH,
            route: `${this.mailingListBaseRoute}/preferences`,
            openApi: { useInOpenApi: true, tags: ['MailingLists'] },
            bodyMetadata: { modelClass: UpdateMailingListPreferences, required: false },
            queryParams: {
                subscriberId: { type: 'string' }
            },
            handler: async (req) => {
                const updatedSubscriber: MailingListSubscriber = await this.subscriberRepository.updateById(
                    req.query.subscriberId,
                    {
                        mailingLists: req.body.mailingListIds.map(id => ({ id }))
                    }
                );
                return updatedSubscriber;
            }
        });
    }

    private validate(): void {
        const entitiesInDataSources: Newable<BaseEntity>[] = [];
        for (const dataSourceClass of GlobalRegistry.dataSourceClasses) {
            const dataSource: BaseDataSource = inject(dataSourceClass);
            entitiesInDataSources.push(...dataSource.entities);
        }
        if (!entitiesInDataSources.includes(MailingList)) {
            const message: string[] = [
                INITIALIZE_ERROR_MESSAGE,
                'Could not find data source for the MailingList entity:',
                INITIALIZE_ERROR_QUESTION
            ];
            throw new Error(message.join('\n'));
        }
        if (!entitiesInDataSources.includes(MailingListSubscriber)) {
            const message: string[] = [
                INITIALIZE_ERROR_MESSAGE,
                'Could not find data source for the MailingListSubscriber entity:',
                INITIALIZE_ERROR_QUESTION
            ];
            throw new Error(message.join('\n'));
        }
        if (!entitiesInDataSources.includes(MailingListSubscriptionConfirmationToken)) {
            const message: string[] = [
                INITIALIZE_ERROR_MESSAGE,
                'Could not find data source for the MailingListSubscriptionConfirmationToken entity:',
                INITIALIZE_ERROR_QUESTION
            ];
            throw new Error(message.join('\n'));
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async queueEmailForList<T extends BaseMailingListEmailTemplateData>(listId: string, data: MailingListQueueEmailData<T>): Promise<void> {
        const list: MailingList = await this.mailingListRepository.findById(listId);
        await chunkedPromiseAll(
            list.subscribers.map(async s => {
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
                    path.join(this.assetService.emailTemplatePath, 'base-email.hbs') as `${string}.hbs`,
                    { content, base }
                );
                await this.emailService.queue({
                    html,
                    priority: EmailPriority.LOW,
                    recipients: [s.email],
                    persist: false,
                    ...data
                });
            })
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async requestSubscribeToList<T extends BaseMailingListEmailTemplateData>(
        listId: string,
        subscriber: MailingListSubscriberCreateData,
        emailData: MailingListQueueEmailData<T>
    ): Promise<void> {
        const confirmationTokenRepository: Repository<
            MailingListSubscriptionConfirmationToken,
            MailingListSubscriptionConfirmationTokenCreateData
        > = inject(repositoryTokenFor(MailingListSubscriptionConfirmationToken));

        const foundSubscriber: MailingListSubscriber | undefined = await this.subscriberRepository.findOne(
            { where: { email: subscriber.email } },
            false
        );
        if (foundSubscriber) {
            const list: MailingList = await this.mailingListRepository.findById(listId);
            await this.subscriberRepository.updateById(foundSubscriber.id, { mailingLists: [...foundSubscriber.mailingLists, list] });
            return;
        }

        await confirmationTokenRepository.create({
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
            path.join(this.assetService.emailTemplatePath, 'base-email.hbs') as `${string}.hbs`,
            { content, base: emailData.templateData.base }
        );
        await this.emailService.queue({ ...emailData, html, recipients: [subscriber.email] });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async confirmSubscribeToList(confirmationTokenValue: string): Promise<void> {
        const confirmationTokenRepository: Repository<
            MailingListSubscriptionConfirmationToken,
            MailingListSubscriptionConfirmationTokenCreateData
        > = inject(repositoryTokenFor(MailingListSubscriptionConfirmationToken));

        const foundToken: MailingListSubscriptionConfirmationToken = await confirmationTokenRepository.findOne(
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

// eslint-disable-next-line jsdoc/require-jsdoc
function maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!domain) {
        return email;
    }
    const visible: string = local.slice(0, 2);
    const stars: string = '*'.repeat(Math.max(0, local.length - 2));
    return `${visible}${stars}@${domain}`;
}

handlebars.registerHelper('maskEmail', (email: unknown) => {
    if (typeof email !== 'string') {
        return '';
    }
    return new handlebars.SafeString(maskEmail(email));
});