import { ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS } from './mailing-list.tokens.ts';
import { type MailingListPreferencesPageTemplate } from './models/mailing-list-preferences-page-template.model.ts';
import { type MailingListSubscribeSuccessPageTemplate } from './models/mailing-list-subscribe-success-page-template.model.ts';
import { MailingListSubscriber } from './models/mailing-list-subscriber.model.ts';
import { type MailingListUnsubscribeConfirmationPageTemplate } from './models/mailing-list-unsubscribe-confirmation-page-template.model.ts';
import { MailingList } from './models/mailing-list.model.ts';
import { UpdateMailingListPreferences } from './models/update-mailing-list-preferences.model.ts';
import { type MailingListServiceInterface } from './services/mailing-list-service.interface.ts';
import { ZibriApplication } from '../../application/application.ts';
import { Auth } from '../../auth/decorators/auth.decorator.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { Inject } from '../../di/decorators/inject.decorator.ts';
import { NoProviderError } from '../../di/errors/no-provider.error.ts';
import { inject } from '../../di/inject.function.ts';
import { OnAppInit } from '../../global/on-app-init.interface.ts';
import { Response } from '../../open-api/decorators/response.decorator.ts';
import { HtmlResponse } from '../../parsing/html/html-response.model.ts';
import { Body } from '../../routing/decorators/body.decorator.ts';
import { Controller } from '../../routing/decorators/controller.decorator.ts';
import { Get } from '../../routing/decorators/get.decorator.ts';
import { Param } from '../../routing/decorators/param.decorator.ts';
import { Patch } from '../../routing/decorators/patch.decorator.ts';
import { Post } from '../../routing/decorators/post.decorator.ts';
import { TsxUtilities } from '../../tsx/tsx.utilities.ts';

// reached from a link in an email, by someone who is not logged in and may not have an account at
// all, so these cannot require one whatever the application declared. Redundant on purpose for the
// same reason as the builtin auth controllers: a plugin does not know the host's `defaultAuth`.
@Auth.skip({ allowRedundant: true })
@Controller('/mailing-lists', { allowOrphan: true, versions: 'all' })
export class MailingListController implements OnAppInit {

    // the two below are read when used rather than injected: controllers are built before any init,
    // and ZibriMailingListPlugin.validate names the entities that are missing - which it could not,
    // if building this had failed on a repository token first
    private get subscriberRepository(): Repository<MailingListSubscriber> {
        return inject(repositoryTokenFor(MailingListSubscriber));
    }

    private get mailingListRepository(): Repository<MailingList> {
        return inject(repositoryTokenFor(MailingList));
    }

    constructor(
        @Inject(ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.MAILING_LIST_SERVICE)
        private readonly mailingListService: MailingListServiceInterface,
        @Inject(ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.PREFERENCES_PAGE_TEMPLATE)
        private readonly PreferencesPage: MailingListPreferencesPageTemplate,
        @Inject(ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.UNSUBSCRIBE_CONFIRMATION_PAGE_TEMPLATE)
        private readonly UnsubscribeConfirmationPage: MailingListUnsubscribeConfirmationPageTemplate,
        @Inject(ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.SUBSCRIBE_SUCCESS_PAGE_TEMPLATE)
        private readonly SubscribeSuccessPage: MailingListSubscribeSuccessPageTemplate
    ) {}

    onAppInit(app: ZibriApplication): void {
        if (app.options.controllers.find(c => c === MailingListController)) {
            if (inject(ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.PREFERENCES_PAGE_TEMPLATE) == undefined) {
                throw new NoProviderError(ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.PREFERENCES_PAGE_TEMPLATE, []);
            }
            if (inject(ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.UNSUBSCRIBE_CONFIRMATION_PAGE_TEMPLATE) == undefined) {
                throw new NoProviderError(ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.UNSUBSCRIBE_CONFIRMATION_PAGE_TEMPLATE, []);
            }
            if (inject(ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.SUBSCRIBE_SUCCESS_PAGE_TEMPLATE) == undefined) {
                throw new NoProviderError(ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.SUBSCRIBE_SUCCESS_PAGE_TEMPLATE, []);
            }
        }
    }

    @Response.html()
    @Get('/:id/subscribe/:token')
    async subscribe(
        @Param.path('id')
        id: string,
        @Param.path('token')
        token: string
    ): Promise<HtmlResponse> {
        const mailingList: MailingList = await this.mailingListRepository.findById(id);

        const subscriber: MailingListSubscriber = await this.mailingListService.confirmSubscribeToList(id, token);
        const managePreferencesLink: string = await this.mailingListService.resolveManagePreferencesLink(subscriber);

        const html: string = TsxUtilities.renderPage(
            this.SubscribeSuccessPage,
            { subscriber, mailingList, managePreferencesLink }
        );
        return HtmlResponse.fromString(html);
    }

    // a GET changes nothing: mail scanners and link previews follow every link in a mail, and would
    // unsubscribe the recipient. The page posts to the same link, as a mailbox provider's own
    // unsubscribe button does (RFC 8058)
    @Response.html()
    @Get('/:id/unsubscribe')
    async unsubscribePage(
        @Param.path('id')
        id: string,
        @Param.query('subscriberId', { type: 'string', format: 'uuid' })
        subscriberId: string,
        @Param.query('secret', { type: 'string' })
        secret: string
    ): Promise<HtmlResponse> {
        const subscriber: MailingListSubscriber = await this.mailingListService.resolveSubscriberOfLink(subscriberId, secret);
        return await this.renderUnsubscribePage(id, subscriber, !subscriber.mailingLists.some(l => l.id === id));
    }

    @Response.html()
    @Post('/:id/unsubscribe')
    async unsubscribe(
        @Param.path('id')
        id: string,
        @Param.query('subscriberId', { type: 'string', format: 'uuid' })
        subscriberId: string,
        @Param.query('secret', { type: 'string' })
        secret: string
    ): Promise<HtmlResponse> {
        // the body a mailbox provider sends, `List-Unsubscribe=One-Click`, says nothing the link does not
        const subscriber: MailingListSubscriber = await this.mailingListService.resolveSubscriberOfLink(subscriberId, secret);
        await this.mailingListService.unsubscribeFromList(id, subscriber.id);
        return await this.renderUnsubscribePage(id, subscriber, true);
    }

    @Response.html()
    @Get('/preferences')
    async preferences(
        @Param.query('subscriberId', { type: 'string', format: 'uuid' })
        subscriberId: string,
        @Param.query('secret', { type: 'string' })
        secret: string
    ): Promise<HtmlResponse> {
        const subscriber: MailingListSubscriber = await this.mailingListService.resolveSubscriberOfLink(subscriberId, secret);
        const mailingLists: MailingList[] = await this.mailingListRepository.findAll();
        const managePreferencesApiUrl: string = await this.mailingListService.resolveManagePreferencesLink(subscriber);

        const html: string = TsxUtilities.renderPage(this.PreferencesPage, { subscriber, mailingLists, managePreferencesApiUrl });
        return HtmlResponse.fromString(html);
    }

    @Response.empty()
    @Patch('/preferences')
    async changePreferences(
        @Param.query('subscriberId', { type: 'string', format: 'uuid' })
        subscriberId: string,
        @Param.query('secret', { type: 'string' })
        secret: string,
        @Body(UpdateMailingListPreferences)
        body: UpdateMailingListPreferences
    ): Promise<void> {
        const subscriber: MailingListSubscriber = await this.mailingListService.resolveSubscriberOfLink(subscriberId, secret);
        const mailingLists: MailingList[] = await this.mailingListRepository.findAll({ where: { id: { oneOf: body.mailingListIds } } });
        await this.subscriberRepository.updateById(subscriber.id, { mailingLists });
    }

    /**
     * Renders the page of an unsubscribe link.
     * @param listId - The list the link leaves.
     * @param subscriber - The subscriber the link was sent to.
     * @param unsubscribed - Whether the subscriber is off the list.
     * @returns The page.
     */
    private async renderUnsubscribePage(listId: string, subscriber: MailingListSubscriber, unsubscribed: boolean): Promise<HtmlResponse> {
        const mailingList: MailingList = await this.mailingListRepository.findById(listId);
        const html: string = TsxUtilities.renderPage(
            this.UnsubscribeConfirmationPage,
            {
                subscriber,
                mailingList,
                unsubscribed,
                unsubscribeUrl: await this.mailingListService.resolveUnsubscribeLink(listId, subscriber),
                managePreferencesLink: await this.mailingListService.resolveManagePreferencesLink(subscriber)
            }
        );
        return HtmlResponse.fromString(html);
    }
}