import { AuthStrategies } from './auth-strategies.model';

export type IsNotLoggedInMetadata = {
    allowedStrategies?: AuthStrategies
};

export type SkipIsNotLoggedInMetadata = {};