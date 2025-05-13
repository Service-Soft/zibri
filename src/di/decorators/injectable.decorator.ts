import { MetadataUtilities } from '../../encapsulation';
import { GlobalRegistry } from '../../global';
import { Newable } from '../../types';
import { DiToken } from '../models';

export function Injectable<T>(token?: DiToken<T>): ClassDecorator {
    return target => {
        MetadataUtilities.setDiToken(target, token);
        // eslint-disable-next-line unicorn/error-message
        const stack: string = new Error().stack ?? '';
        MetadataUtilities.setFilePath(target, stack);
        GlobalRegistry.injectables.push({
            token: (token ?? target) as DiToken<T>,
            useClass: target as unknown as Newable<unknown>
        });
    };
}