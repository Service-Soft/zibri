import { DiProvider } from './di';
import { BodyParserInterface } from './parsing';
import { Newable } from './types';

export type ZibriApplicationOptions = {
    name: string,
    controllers: Newable<unknown>[],
    providers?: DiProvider<unknown>[],
    bodyParsers?: Newable<BodyParserInterface>[]
};