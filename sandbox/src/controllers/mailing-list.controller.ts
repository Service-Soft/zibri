import { Body, Controller, Get, HtmlResponse, InjectRepository, MailingList, MailingListService, MailingListSubscriber, Param, Patch, PreactUtilities, Repository, Response, UpdateMailingListPreferences } from 'zibri';

import { MailingListPreferencesPage } from '../templates/pages/mailing-list-preferences';
import { MailingListUnsubscribeConfirmationPage } from '../templates/pages/mailing-list-unsubscribe-confirmation';

@Controller('/mailing-lists')
export class MailingListController {

    constructor(
        @InjectRepository(MailingListSubscriber)
        private readonly subscriberRepository: Repository<MailingListSubscriber>,
        @InjectRepository(MailingList)
        private readonly mailingListRepository: Repository<MailingList>,
        private readonly mailingListService: MailingListService
    ) {}

    @Response.html()
    @Get('/:id/unsubscribe')
    async unsubscribe(
        @Param.path('id')
        id: string,
        @Param.query('subscriberId')
        subscriberId: string
    ): Promise<HtmlResponse> {
        const subscriber: MailingListSubscriber = await this.subscriberRepository.findById(subscriberId);
        const mailingList: MailingList = await this.mailingListRepository.findById(id);

        await this.mailingListService.unsubscribeFromList(id, subscriberId);

        return PreactUtilities.renderResponse(MailingListUnsubscribeConfirmationPage, { subscriber, mailingList });
    }

    @Response.html()
    @Get('/preferences')
    async preferences(
        @Param.query('subscriberId')
        subscriberId: string
    ): Promise<HtmlResponse> {
        const subscriber: MailingListSubscriber = await this.subscriberRepository.findById(subscriberId);
        const mailingLists: MailingList[] = await this.mailingListRepository.findAll();
        return PreactUtilities.renderResponse(MailingListPreferencesPage, { subscriber, mailingLists });
    }

    @Response.empty()
    @Patch('/preferences')
    async changePreferences(
        @Param.query('subscriberId')
        subscriberId: string,
        @Body(UpdateMailingListPreferences)
        body: UpdateMailingListPreferences
    ): Promise<void> {
        const mailingLists: MailingList[] = await this.mailingListRepository.findAll({ where: { id: { oneOf: body.mailingListIds } } });
        await this.subscriberRepository.updateById(subscriberId, { mailingLists });
    }
}