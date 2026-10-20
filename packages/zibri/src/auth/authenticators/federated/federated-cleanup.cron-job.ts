import { FederatedConnectionCode } from './federated-connection-code.model.ts';
import { FederatedHandoverCode } from './federated-handover-code.model.ts';
import { FederatedLoginAttempt } from './federated-login-attempt.model.ts';
import { FederatedRegistrationTicket } from './federated-registration-ticket.model.ts';
import { CronExpression } from '../../../cron/cron-expression.utilities.ts';
import { CronJob, InitialCronConfig } from '../../../cron/cron-job.model.ts';
import { Repository } from '../../../data-source/repository/repository.ts';
import { InjectRepository } from '../../../di/decorators/inject-repository.decorator.ts';

/**
 * Deletes the sign-ins at a provider that expired before they were completed, and the codes and
 * tickets that expired before they were spent.
 */
export class FederatedCleanupCronJob extends CronJob {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
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

    // eslint-disable-next-line jsdoc-js/require-jsdoc
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