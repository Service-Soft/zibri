import { CronExpression } from '../../../cron/cron-expression.utilities.ts';
import { CronJob, InitialCronConfig } from '../../../cron/cron-job.model.ts';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../../di/inject.function.ts';

/**
 * A directory the job asks for its disabled entries.
 */
type DisabledEntryEnding = {
    /**
     * Ends the logins and api keys of the users whose entries were disabled or deleted.
     */
    endAccessOfDisabledEntries: () => Promise<void>
};

/**
 * Checks whether or not an authenticator is a directory the job asks.
 * @param value - The authenticator.
 * @returns True if it ends the access of users whose entries were disabled.
 */
function isDisabledEntryEnding<T extends object>(value: T): value is T & DisabledEntryEnding {
    // by the method rather than by BaseLdapAuthenticator, which registers this job and would otherwise
    // be imported by it in turn
    return 'endAccessOfDisabledEntries' in value;
}

/**
 * Ends the logins and api keys of the users whose entries were disabled or deleted in a directory.
 * `BaseLdapAuthenticator` registers it, and every directory of the application is asked.
 */
export class DisabledLdapEntriesCronJob extends CronJob {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    initialConfig: InitialCronConfig = {
        name: 'Disabled Directory Entries',
        cron: CronExpression.every(15, 'minutes').build(),
        runOnInit: false
    };

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async onTick(): Promise<void> {
        const directories: DisabledEntryEnding[] = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE).authenticators
            .map(authenticator => inject(authenticator))
            .filter(isDisabledEntryEnding);
        // settled rather than all, so a directory that cannot be reached leaves the others checked
        const results: PromiseSettledResult<void>[] = await Promise.allSettled(
            directories.map(async d => await d.endAccessOfDisabledEntries())
        );
        // eslint-disable-next-line typescript/no-unsafe-return
        const failures: unknown[] = results.filter(r => r.status === 'rejected').map(r => r.reason);
        if (failures.length) {
            throw new AggregateError(failures, 'Some directories could not be checked for disabled entries.');
        }
    }
}