import { DiToken } from '.';
import { Newable } from '../../types';

export type DiProvider<T> = {
    token: DiToken<T>,
    useClass?: Newable<T>,
    useFactory?: (...deps: unknown[]) => T
};