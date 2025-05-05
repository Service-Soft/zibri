import { Router } from '../routing';
import { Newable } from '../types';
import { CATALYX_DI_TOKENS } from './catalyx-di-tokens';

export const CLASS_FOR_CATALYX_DI_TOKENS: Record<typeof CATALYX_DI_TOKENS[keyof typeof CATALYX_DI_TOKENS], Newable<unknown>> = {
    [CATALYX_DI_TOKENS.ROUTER]: Router
};