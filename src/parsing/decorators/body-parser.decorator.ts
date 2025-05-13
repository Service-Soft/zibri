import { MetadataUtilities } from '../../encapsulation';
import { GlobalRegistry } from '../../global';
import { Newable } from '../../types';
import { BodyParserInterface } from '../body-parser.interface';

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