import { Repository } from '../../data-source';
import { inject, repositoryTokenFor } from '../../di';
import { Log } from '../log.model';

/**
 * Saves the given log in the data source.
 * @param log - The log to save.
 */
export async function logToDb(log: Log): Promise<void> {
    const logRepository: Repository<Log> = inject(repositoryTokenFor(Log));
    await logRepository.create(log, { allowId: true });
}