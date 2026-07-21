import { InternalError } from '../../error-handling/internal-error.model';

const allDiVariants: string[] = [];

/**
 * A variant of a injectable. Can be created using the "defineDiVariant" function.
 */
export class DiVariant {
    // eslint-disable-next-line jsdoc/require-jsdoc
    protected readonly __brand: 'DiVariant' = 'DiVariant';

    constructor(readonly variant: string) {
        if (allDiVariants.includes(variant)) {
            throw new InternalError(`A DiVariant with the value "${variant}" already exists.`);
        }
        allDiVariants.push(variant);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    toString(): string {
        return this.variant;
    }
}

/**
 * The different di variants of zibri.
 */
// eslint-disable-next-line typescript/typedef
export const DiVariants = {
    RATE_LIMITER: new DiVariant('rate-limiter'),
    CACHE: new DiVariant('cache'),
    USER_REPO: new DiVariant('user-repo'),
    CONTROLLER: new DiVariant('controller'),
    WEBSOCKET_CONTROLLER: new DiVariant('websocket-controller'),
    BACKUP_RESOURCE: new DiVariant('backup-resource'),
    BODY_PARSER: new DiVariant('body-parser')
} as const satisfies Record<string, DiVariant>;