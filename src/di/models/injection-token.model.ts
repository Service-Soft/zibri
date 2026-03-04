const allInjectionTokenKeys: string[] = [];

/**
 * Defines an injection token for the given key.
 */
export class InjectionToken<T> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    protected readonly __brand?: T;

    constructor(readonly key: string) {
        if (allInjectionTokenKeys.includes(key)) {
            throw new Error([
                `An InjectionToken with the key "${key}" already exists.`,
                'If you wanted to override it, you need to use the existing InjectionToken instance.'
            ].join('\n'));
        }
        allInjectionTokenKeys.push(key);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    toString(): string {
        return this.key;
    }
}