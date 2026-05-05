import { GlobalRegistry } from '../../global/global-registry';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { CacheInterface } from '../cache/cache.interface';

/**
 * Marks a class that should be used as a cache.
 */
export function Cache(): ClassDecorator {
    return target => {
        // eslint-disable-next-line unicorn/error-message
        const stack: string = new Error().stack ?? '';
        MetadataUtilities.setFilePath(target, stack);
        GlobalRegistry.injectables.push({
            token: target as unknown as Newable<unknown>,
            useClass: target as unknown as Newable<unknown>
        });
        // eslint-disable-next-line typescript/no-explicit-any
        GlobalRegistry.cacheClasses.push(target as unknown as Newable<CacheInterface<any, any, any, any>>);
    };
}