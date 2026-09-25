import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { Log } from '../log.model';

/**
 * Saves the given logs in the data source.
 *
 * One statement for the whole batch rather than one per entry. The logger buffers, so the entries
 * arrive together anyway - writing them one at a time was a round trip per log call, on a path an
 * application takes once per request now that there is an access log.
 * @param logs - The logs to save, oldest first.
 */
export async function logToDb(logs: Log[]): Promise<void> {
    const logRepository: Repository<Log> = inject(repositoryTokenFor(Log));
    await logRepository.createAll(logs, { allowId: true });
}