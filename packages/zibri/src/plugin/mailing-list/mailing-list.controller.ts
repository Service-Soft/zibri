import { ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS } from './mailing-list.tokens';
import { type MailingListPreferencesPageTemplate } from './models/mailing-list-preferences-page-template.model';
import { type MailingListSubscribeSuccessPageTemplate } from './models/mailing-list-subscribe-success-page-template.model';
import { MailingListSubscriber } from './models/mailing-list-subscriber.model';
import { type MailingListUnsubscribeConfirmationPageTemplate } from './models/mailing-list-unsubscribe-confirmation-page-template.model';
import { MailingList } from './models/mailing-list.model';
import { UpdateMailingListPreferences } from './models/update-mailing-list-preferences.model';
import { type MailingListServiceInterface } from './services/mailing-list-service.interface';
import { Auth } from '../../auth/decorators/auth.decorator';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { NoProviderError } from '../../di/errors/no-provider.error';
import { inject } from '../../di/inject.function';
import { InjectionToken } from '../../di/models/injection-token.model';
import { OnAppInit } from '../../global/on-app-init.interface';
import { Response } from '../../open-api/decorators/response.decorator';
import { HtmlResponse } from '../../parsing/html/html-response.model';
import { Body } from '../../routing/decorators/body.decorator';
import { Get } from '../../routing/decorators/get.decorator';
import { Param } from '../../routing/decorators/param.decorator';
import { Patch } from '../../routing/decorators/patch.decorator';
import { Post } from '../../routing/decorators/post.decorator';
import { TsxUtilities } from '../../tsx/tsx.utilities';

/**
 * The routes of the mailing lists, below the path of the controller that extends it: confirming a
 * subscription, unsubscribing, and the preferences page. The one-click unsubscribe link of every email
 * to a list points at it, and so do the other links unless `PAGES_URL` names pages of your own.
 */
// no @Controller of its own: the application's class extending this one says where the routes are,
// and a decorator here would register the class at every import of the package
export class MailingListController implements OnAppInit {
    // read when used rather than injected: an application extends this class, and
    // ZibriMailingListPlugin.validate names the entities that are missing - which it could not, if
    // building this had failed on a repository token first
    private get mailingListRepository(): Repository<MailingList> {
        return inject(repositoryTokenFor(MailingList));
    }

    private get mailingListService(): MailingListServiceInterface {
        return inject(ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.MAILING_LIST_SERVICE);
    }

    onAppInit(): void {
        this.resolveTemplate(ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.PREFERENCES_PAGE_TEMPLATE);
        this.resolveTemplate(ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.UNSUBSCRIBE_CONFIRMATION_PAGE_TEMPLATE);
        this.resolveTemplate(ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.SUBSCRIBE_SUCCESS_PAGE_TEMPLATE);
    }

    // reached from a link in an email, by someone who is not logged in and may not have an account at
    // all, so these cannot require one whatever the application declared. Redundant on purpose for the
    // same reason as the builtin auth controllers: a plugin does not know the host's `defaultAuth`. On
    // each route rather than the class, which the application's class extending this one would not inherit
    @Auth.skip({ allowRedundant: true })
    @Response.html()
    @Get('/:id/subscribe/:token')
    async confirmSubscription(
        @Param.path('id')
        id: string,
        @Param.path('token')
        token: string
    ): Promise<HtmlResponse> {
        const mailingList: MailingList = await this.mailingListRepository.findById(id);

        const subscriber: MailingListSubscriber = await this.mailingListService.confirmSubscription(id, token);
        const managePreferencesLink: string = await this.mailingListService.resolveManagePreferencesLink(subscriber);

        const html: string = TsxUtilities.renderPage(
            this.resolveTemplate<MailingListSubscribeSuccessPageTemplate>(
                ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.SUBSCRIBE_SUCCESS_PAGE_TEMPLATE
            ),
            { subscriber, mailingList, managePreferencesLink }
        );
        return HtmlResponse.fromString(html);
    }

    // a GET changes nothing: mail scanners and link previews follow every link in a mail, and would
    // unsubscribe the recipient. The page posts to the same link, as a mailbox provider's own
    // unsubscribe button does (RFC 8058)
    @Auth.skip({ allowRedundant: true })
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

    @Auth.skip({ allowRedundant: true })
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

    @Auth.skip({ allowRedundant: true })
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

        const html: string = TsxUtilities.renderPage(
            this.resolveTemplate<MailingListPreferencesPageTemplate>(ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.PREFERENCES_PAGE_TEMPLATE),
            { subscriber, mailingLists, managePreferencesApiUrl }
        );
        return HtmlResponse.fromString(html);
    }

    @Auth.skip({ allowRedundant: true })
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
        await this.mailingListService.updateSubscriptions(subscriber.id, body.mailingListIds);
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
            this.resolveTemplate<MailingListUnsubscribeConfirmationPageTemplate>(
                ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.UNSUBSCRIBE_CONFIRMATION_PAGE_TEMPLATE
            ),
            {
                subscriber,
                mailingList,
                unsubscribed,
                // the route above that takes the post, wherever the links of the emails point
                unsubscribeUrl: await this.mailingListService.resolveOneClickUnsubscribeLink(listId, subscriber),
                managePreferencesLink: await this.mailingListService.resolveManagePreferencesLink(subscriber)
            }
        );
        return HtmlResponse.fromString(html);
    }

    /**
     * Reads a page template of the plugin.
     * @param token - The token it is provided under.
     * @returns The template.
     * @throws A NoProviderError when none is provided.
     */
    private resolveTemplate<T>(token: InjectionToken<T | undefined>): T {
        const template: T | undefined = inject(token);
        if (template == undefined) {
            throw new NoProviderError(token, []);
        }
        return template;
    }
}