import { AuthStrategies } from './auth';
import { BaseDataSource } from './data-source';
import { DiProvider } from './di';
import { BodyParserInterface } from './parsing';
import { Newable, Version } from './types';

export type ZibriApplicationOptions = {
    name: string,
    version: Version,
    controllers: Newable<unknown>[],
    dataSources?: Newable<BaseDataSource>[],
    providers?: DiProvider<unknown>[],
    bodyParsers?: Newable<BodyParserInterface>[],
    authStrategies?: AuthStrategies
};