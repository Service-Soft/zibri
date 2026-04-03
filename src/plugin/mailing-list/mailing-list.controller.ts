import { ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS } from './mailing-list.tokens';
import { MailingListSubscriber } from './models/mailing-list-subscriber.model';
import { MailingList } from './models/mailing-list.model';
import { UpdateMailingListPreferences } from './models/update-mailing-list-preferences.model';
import { type MailingListServiceInterface } from './services/mailing-list-service.interface';
import { ZibriApplication } from '../../application';
import { type MailingListPreferencesPageTemplate } from './models/mailing-list-preferences-page-template.model';
import { type MailingListSubscribeSuccessPageTemplate } from './models/mailing-list-subscribe-success-page-template.model';
import { type MailingListUnsubscribeConfirmationPageTemplate } from './models/mailing-list-unsubscribe-confirmation-page-template.model';
import { Repository } from '../../data-source/repository';
import { InjectRepository } from '../../di/decorators/inject-repository.decorator';
import { Inject } from '../../di/decorators/inject.decorator';
import { NoProviderError } from '../../di/errors/no-provider.error';
import { inject } from '../../di/inject.function';
import { OnAppInit } from '../../global/on-app-init.interface';
import { Response } from '../../open-api/decorators/response.decorator';
import { HtmlResponse } from '../../parsing/html/html-response.model';
import { PreactUtilities } from '../../preact/preact.utilities';
import { Body } from '../../routing/decorators/body.decorator';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Get } from '../../routing/decorators/get.decorator';
import { Param } from '../../routing/decorators/param.decorator';
import { Patch } from '../../routing/decorators/patch.decorator';

@Controller('/mailing-lists', { allowOrphan: true })
export class MailingListController implements OnAppInit {

    constructor(
        @InjectRepository(MailingListSubscriber)
        private readonly subscriberRepository: Repository<MailingListSubscriber>,
        @InjectRepository(MailingList)
        private readonly mailingListRepository: Repository<MailingList>,
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

        const subscriber: MailingListSubscriber = await this.mailingListService.confirmSubscribeToList(token);
        const managePreferencesLink: string = this.mailingListService.getManagePreferencesLink(subscriber.id);

        return PreactUtilities.renderResponse(this.SubscribeSuccessPage, { subscriber, mailingList, managePreferencesLink });
    }

    @Response.html()
    @Get('/:id/unsubscribe')
    async unsubscribe(
        @Param.path('id')
        id: string,
        @Param.query('subscriberId', { type: 'string', format: 'uuid' })
        subscriberId: string
    ): Promise<HtmlResponse> {
        const subscriber: MailingListSubscriber = await this.subscriberRepository.findById(subscriberId);
        const mailingList: MailingList = await this.mailingListRepository.findById(id);

        await this.mailingListService.unsubscribeFromList(id, subscriberId);
        const managePreferencesLink: string = this.mailingListService.getManagePreferencesLink(subscriberId);

        return PreactUtilities.renderResponse(this.UnsubscribeConfirmationPage, { subscriber, mailingList, managePreferencesLink });
    }

    @Response.html()
    @Get('/preferences')
    async preferences(
        @Param.query('subscriberId', { type: 'string', format: 'uuid' })
        subscriberId: string
    ): Promise<HtmlResponse> {
        const subscriber: MailingListSubscriber = await this.subscriberRepository.findById(subscriberId);
        const mailingLists: MailingList[] = await this.mailingListRepository.findAll();
        const managePreferencesApiUrl: string = this.mailingListService.getManagePreferencesLink(subscriberId);

        return PreactUtilities.renderResponse(this.PreferencesPage, { subscriber, mailingLists, managePreferencesApiUrl });
    }

    @Response.empty()
    @Patch('/preferences')
    async changePreferences(
        @Param.query('subscriberId', { type: 'string', format: 'uuid' })
        subscriberId: string,
        @Body(UpdateMailingListPreferences)
        body: UpdateMailingListPreferences
    ): Promise<void> {
        const mailingLists: MailingList[] = await this.mailingListRepository.findAll({ where: { id: { oneOf: body.mailingListIds } } });
        await this.subscriberRepository.updateById(subscriberId, { mailingLists });
    }
}