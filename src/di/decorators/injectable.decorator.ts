import { MetadataUtilities } from '../../encapsulation';
import { globalInjectables } from '../../global';
import { Newable } from '../../types';
import { DiToken } from '../di-token.model';

export function Injectable<T>(token?: DiToken<T>): ClassDecorator {
    return target => {
        MetadataUtilities.setDiToken(target, token);
        // eslint-disable-next-line unicorn/error-message
        const stack: string = new Error().stack ?? '';
        MetadataUtilities.setFilePath(target, stack);
        globalInjectables.push({
            token: (token ?? target) as DiToken<T>,
            useClass: target as unknown as Newable<unknown>
        });
    };
}