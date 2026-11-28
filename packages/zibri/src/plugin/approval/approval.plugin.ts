import { ZibriApplication } from '../../application/application';
import { CronJob } from '../../cron/cron-job.model';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { DiProvider } from '../../di/models/di-provider.model';
import { DiTokenProviderRecord, providersFromTokenRecord } from '../../di/models/di-token.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { Newable } from '../../types/newable.type';
import { Ms } from '../../utilities/ms';
import { validateEntitiesRegistered } from '../../utilities/validate-entities-registered.function';
import { validateTokensRegistered } from '../../utilities/validate-tokens-registered.function';
import { ZibriPlugin } from '../plugin.model';
import { ApprovalRequestExpiryCronJob } from './approval-request-expiry.cron-job';
import { ApprovalRequestUtilities } from './approval-request.utilities';
import { ZIBRI_APPROVAL_PLUGIN_DI_TOKENS } from './approval.tokens';
import { ApprovalDecision } from './models/approval-decision.model';
import { ApprovalPluginOptionsInput } from './models/approval-plugin-options-input.model';
import { ApprovalPluginOptions } from './models/approval-plugin-options.model';
import { ApprovalRequest } from './models/approval-request.model';
import { ApprovalRequestService } from './services/approval-request.service';

/**
 * Plugin that lets actors propose actions, which a person or a policy approves before they run.
 */
export class ZibriApprovalPlugin extends ZibriPlugin {
    private readonly defaultDiProviders: DiTokenProviderRecord<typeof ZIBRI_APPROVAL_PLUGIN_DI_TOKENS> = {
        OPTIONS_INPUT: { useFactory: () => ({}) },
        OPTIONS: {
            useFactory: () => {
                const input: ApprovalPluginOptionsInput = inject(ZIBRI_APPROVAL_PLUGIN_DI_TOKENS.OPTIONS_INPUT);
                const res: ApprovalPluginOptions = { expiresInMs: Ms.DAY * 7, eventNames: {}, ...input };
                return res;
            }
        },
        APPROVAL_REQUEST_SERVICE: { useClass: ApprovalRequestService }
    };

    override providers: DiProvider<unknown>[] = providersFromTokenRecord(ZIBRI_APPROVAL_PLUGIN_DI_TOKENS, this.defaultDiProviders);

    override cronJobs: Newable<CronJob>[] = [ApprovalRequestExpiryCronJob];

    // eslint-disable-next-line jsdoc/require-jsdoc
    validate(app: ZibriApplication): void {
        validateEntitiesRegistered(this.constructor.name, app, ApprovalRequest, ApprovalDecision);
        validateTokensRegistered(this.constructor.name, ZIBRI_APPROVAL_PLUGIN_DI_TOKENS);
        // a decision is recorded in the transaction its action runs in, which is one of a single data source
        const requests: Repository<ApprovalRequest> = inject(repositoryTokenFor(ApprovalRequest));
        const decisions: Repository<ApprovalDecision> = inject(repositoryTokenFor(ApprovalDecision));
        if (requests.dataSource !== decisions.dataSource) {
            throw new InternalError(`${this.constructor.name} needs ApprovalRequest and ApprovalDecision in the same data source.`);
        }
        const options: ApprovalPluginOptions = inject(ZIBRI_APPROVAL_PLUGIN_DI_TOKENS.OPTIONS);
        if (options.expiresInMs <= 0) {
            throw new InternalError(`${this.constructor.name} needs an expiresInMs above 0.`);
        }
        // read once here, so that a provider holding no action or two actions of one name stop the start
        ApprovalRequestUtilities.resolveRegisteredActions();
    }
}