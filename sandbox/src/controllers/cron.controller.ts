import { Controller, Post, Response, Inject, ZIBRI_DI_TOKENS, CronService, CronJobEntity, Get, InjectRepository, Repository } from 'zibri';

@Controller('/cron')
export class CronController {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.CRON_SERVICE)
        private readonly cronService: CronService,
        @InjectRepository(CronJobEntity)
        private readonly cronJobRepository: Repository<CronJobEntity>
    ) {}

    @Response.array(CronJobEntity)
    @Get()
    async get(): Promise<CronJobEntity[]> {
        return this.cronJobRepository.findAll();
    }

    @Response.empty()
    @Post('/enable-status')
    async enable(): Promise<void> {
        await this.cronService.enable('Status');
    }

    @Response.empty()
    @Post('/disable-status')
    async disable(): Promise<void> {
        await this.cronService.disable('Status');
    }
}