import { describe, expect, it } from '@jest/globals';

import { BaseEntity } from './base-entity.model';
import { CacheInvalidation } from '../caching/cache-invalidation.model';
import { Email } from '../email/models/email.model';
import { Event } from '../event/event.model';
import { ThreadJobEntity } from '../multithreading/models/thread-job-entity.model';
import { Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';

/**
 * The entities an instance polls on a timer, and the columns each poll filters on.
 *
 * Every instance reads these tables every few seconds, so a scan over a table that only grows is a
 * poll that slows down with every row ever written.
 */
const polled: [Newable<BaseEntity>, string[]][] = [
    [ThreadJobEntity, ['status', 'priority', 'queuedAtMs']],
    [Email, ['status', 'priority', 'retryAt']],
    [Event, ['status', 'nextDispatchAt']],
    [CacheInvalidation, ['at']]
];

describe('the polled entities', () => {
    it.each(polled)('%p declares an index covering what its poll filters on', (entity, columns) => {
        const indexes: string[][] = MetadataUtilities.getEntityMetadata(entity)?.indexes ?? [];

        expect(indexes).toContainEqual(columns);
    });
});