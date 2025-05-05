import { Newable } from '../types';
import { DiToken } from './di-token.model';

export type DiProvider<T> = {
    token: DiToken<T>,
    useClass?: Newable<T>,
    useFactory?: (...deps: unknown[]) => T
};