import { FederatedConnectionCode } from './federated-connection-code.model';
import { FederatedHandoverCode } from './federated-handover-code.model';
import { FederatedLoginAttempt } from './federated-login-attempt.model';
import { FederatedRegistrationTicket } from './federated-registration-ticket.model';
import { CronExpression } from '../../../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../../../cron/cron-job.model';
import { Repository } from '../../../data-source/repository/repository';
import { InjectRepository } from '../../../di/decorators/inject-repository.decorator';

/**
 * Deletes the sign-ins at a provider that expired before they were completed, and the codes and
 * tickets that expired before they were spent.
 */
export class FederatedCleanupCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    initialConfig: InitialCronConfig = {
        name: 'Cleanup sign-ins at providers',
        cron: CronExpression.every(1, 'hours').build(),
        runOnInit: false
    };

    constructor(
        @InjectRepository(FederatedLoginAttempt)
        private readonly attemptRepository: Repository<FederatedLoginAttempt>,
        @InjectRepository(FederatedHandoverCode)
        private readonly handoverCodeRepository: Repository<FederatedHandoverCode>,
        @InjectRepository(FederatedRegistrationTicket)
        private readonly registrationTicketRepository: Repository<FederatedRegistrationTicket>,
        @InjectRepository(FederatedConnectionCode)
        private readonly connectionCodeRepository: Repository<FederatedConnectionCode>
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        const now: Date = new Date();
        await Promise.all([
            this.attemptRepository.deleteAll({ expirationDate: { before: now } }),
            this.handoverCodeRepository.deleteAll({ expirationDate: { before: now } }),
            this.registrationTicketRepository.deleteAll({ expirationDate: { before: now } }),
            this.connectionCodeRepository.deleteAll({ expirationDate: { before: now } })
        ]);
    }
}