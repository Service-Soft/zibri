import { LoginTicket, LoginTicketCreateData } from './models/login-ticket.model';
import { CronExpression } from '../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../cron/cron-job.model';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { inject } from '../di/inject.function';

/**
 * Deletes the tickets of logins that were never completed with their second factor.
 */
export class LoginTicketCleanupCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    initialConfig: InitialCronConfig = {
        name: 'Cleanup login tickets',
        cron: CronExpression.every(1, 'hours').build(),
        runOnInit: false
    };

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        const ticketRepository: Repository<LoginTicket, LoginTicketCreateData> = inject(repositoryTokenFor(LoginTicket));
        await ticketRepository.deleteAll({ expirationDate: { before: new Date() } });
    }
}