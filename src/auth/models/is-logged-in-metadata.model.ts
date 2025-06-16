import { AuthStrategies } from './auth-strategies.model';

export type IsLoggedInMetadata = {
    allowedStrategies?: AuthStrategies
};

export type SkipIsLoggedInMetadata = {};