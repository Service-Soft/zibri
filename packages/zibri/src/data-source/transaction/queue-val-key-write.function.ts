import type { Batch } from '@valkey/valkey-glide';

import { type ValKeyBufferedWrite } from './val-key-transaction.model.ts';

/**
 * Adds one write to a batch of commands, to be sent with the rest of the batch.
 * @param batch - The batch to add it to.
 * @param write - The write.
 */
export function queueValKeyWrite(batch: Batch, write: ValKeyBufferedWrite): void {
    switch (write.type) {
        case 'hashSet': {
            // cspell:disable-next-line
            batch.hset(write.key, write.values);
            return;
        }
        case 'hashDelete': {
            // cspell:disable-next-line
            batch.hdel(write.key, write.fields);
            return;
        }
        case 'delete': {
            batch.del([write.key]);
            return;
        }
        case 'setAdd': {
            // cspell:disable-next-line
            batch.sadd(write.key, write.members);
            return;
        }
        case 'setRemove': {
            // cspell:disable-next-line
            batch.srem(write.key, write.members);
            return;
        }
    }
}