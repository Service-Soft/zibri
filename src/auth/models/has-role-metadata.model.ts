import { AuthStrategies } from './auth-strategies.model';

export type HasRoleMetadata = {
    allowedRoles: string[],
    allowedStrategies?: AuthStrategies
};

export type SkipHasRoleMetadata = {};