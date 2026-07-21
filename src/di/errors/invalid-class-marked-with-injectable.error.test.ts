import { describe, expect, it } from '@jest/globals';

import { InvalidClassMarkedWithInjectableError } from './invalid-class-marked-with-injectable.error';
import { InternalError } from '../../error-handling/internal-error.model';

describe('InvalidClassMarkedWithInjectableError', () => {
    it('extends InternalError and sets its name', () => {
        const error: InvalidClassMarkedWithInjectableError = new InvalidClassMarkedWithInjectableError('MyCronJob', 'cronJob');
        expect(error).toBeInstanceOf(InternalError);
        expect(error.name).toBe('InvalidClassMarkedWithInjectableError');
    });

    it.each([
        ['cronJob', 'Cron jobs should be registered by the cron service.'],
        ['plugin', 'Plugins interfere with the injection system, making them injectable is forbidden.'],
        ['twoFactorMethod', 'Two factor methods should be registered by the two factor service.'],
        ['authStrategy', 'Auth strategies should be registered by the auth service.']
    ] as const)('includes the class name and the reason specific message for reason "%s"', (reason, reasonMessage) => {
        const error: InvalidClassMarkedWithInjectableError = new InvalidClassMarkedWithInjectableError('MyClass', reason);
        expect(error.message).toContain('Invalid class marked with @Injectable: MyClass');
        expect(error.message).toContain(reasonMessage);
    });
});