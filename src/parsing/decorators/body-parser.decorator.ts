import { GlobalRegistry } from '../../global';
import { Newable } from '../../types';
import { MetadataUtilities } from '../../utilities';
import { BodyParserInterface } from '../body-parser.interface';

// eslint-disable-next-line jsdoc/require-returns
/**
 * Marks a request body parser.
 */
export function BodyParser(): ClassDecorator {
    return target => {
        // eslint-disable-next-line unicorn/error-message
        const stack: string = new Error().stack ?? '';
        MetadataUtilities.setFilePath(target, stack);
        GlobalRegistry.injectables.push({
            token: target as unknown as Newable<BodyParserInterface>,
            useClass: target as unknown as Newable<BodyParserInterface>
        });
        GlobalRegistry.bodyParsers.push(target as unknown as Newable<BodyParserInterface>);
    };
}