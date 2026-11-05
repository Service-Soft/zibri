import { DataSourceTime } from './data-source-time.model';
import { InternalError } from '../../error-handling/internal-error.model';

/**
 * The time on the clock of the data source as it runs the statement, plus an offset:
 * `{ expiresAt: { before: dataSourceNow() } }` matches the rows that expired, and
 * `{ expiresAt: dataSourceNow(Ms.MINUTE) }` writes a minute from now.
 *
 * It goes where a date comparison takes its value - `after`, `before`, `afterOrOn` and `beforeOrOn` -
 * and where `create`, `createAll` and `updateAll` take the value of a date property. Every instance of
 * an application then compares and writes by the one clock they share, however far their own clocks
 * are apart.
 * @param plusInMs - How far after the time of the data source, in milliseconds. Negative for before it.
 * @returns The time.
 * @throws When the offset is not a finite number.
 */
export function dataSourceNow(plusInMs: number = 0): DataSourceTime {
    if (!Number.isFinite(plusInMs)) {
        throw new InternalError(`dataSourceNow takes a finite number of milliseconds, not ${plusInMs}.`);
    }
    // the one cast that may produce a DataSourceTime. The mark says it was made here, and this is
    // the only place that can know it was
    return { dataSourceNowPlusInMs: plusInMs } as DataSourceTime;
}