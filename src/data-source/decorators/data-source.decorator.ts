import { GlobalRegistry } from '../../global';
import { Newable } from '../../types';
import { MetadataUtilities } from '../../utilities';
import { DataSourceInterface } from '../data-sources';

// eslint-disable-next-line jsdoc/require-returns
/**
 * Marks a class to be a data source.
 */
export function DataSource(): ClassDecorator {
    return target => {
        // eslint-disable-next-line unicorn/error-message
        const stack: string = new Error().stack ?? '';
        MetadataUtilities.setFilePath(target, stack);
        GlobalRegistry.injectables.push({
            token: target as unknown as Newable<unknown>,
            useClass: target as unknown as Newable<unknown>
        });
        GlobalRegistry.dataSourceClasses.push(target as unknown as Newable<DataSourceInterface>);
    };
}