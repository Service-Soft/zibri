import { AlsUtilities, LeaseScopeResult } from '../context/als.utilities';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { type LoggerInterface } from '../logging/logger.interface';
import { Transaction } from './transaction/transaction.model';

/**
 * Runs the work held under a lease and warns when a write made inside it will only land after the
 * grant is gone.
 *
 * A grant and a transaction have independent lifetimes. A write made with a transaction becomes
 * visible on commit, so if the caller commits after the lease has been released, the exclusion ended
 * while the write was still invisible - and the next holder reads a value the previous one already
 * claimed. Both callers were exclusive, over a window that ended too early, and nothing fails.
 *
 * This is the shape of evaluation/10-leases-and-claims.md 10.4, which is why the guard exists at all.
 *
 * Committing inside the held section is fine and is not reported. Only a transaction that is still
 * open when the grant is about to be released is, because that is the case the grant cannot cover.
 *
 * A warning rather than an error on purpose: the transaction may well be carrying writes that have
 * nothing to do with what the lease protects, which is unusual but not wrong. Reporting it costs a
 * log line, guessing wrong and throwing would break working code.
 * @param name - Names the grant, so the warning says which one it is about.
 * @param fn - The work to run under it.
 * @returns Whatever the work returned.
 */
export async function runInLeaseScope<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const scope: LeaseScopeResult<T> = await AlsUtilities.runInLeaseScope(fn);

    const escaping: Transaction[] = scope.transactions.filter(t => !t.isFinished);
    if (escaping.length) {
        const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
        logger.warn([
            `a write made while holding the lease "${name}" used a transaction that is still open now that it is being`,
            'released, so it only becomes visible on a commit the grant will not be held for.',
            'If this is a read-modify-write, the next holder reads the value you already claimed and no error is raised.',
            'Commit the transaction inside the held section, or use an operation the data source performs atomically',
            'when the value has to stay inside a transaction you do not control.'
        ].join(' '));
    }

    return scope.result;
}