import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { MimeType } from '../../http/mime-type.enum';
import { BodyMetadata } from '../../routing/decorators/body.decorator';
import { NumberUtilities } from '../../utilities/number.utilities';
import { ValidationProblem } from '../../validation/validation-problem.model';
import { ValidationService } from '../../validation/validation.service';
import { Property } from '../decorators/property.decorator';
import { IntersectionClass } from '../intersection-class.model';
import { OmitClass } from '../omit-class.model';
import { PartialClass } from '../partial-class.model';
import { PickClass } from '../pick-class.model';

// These helpers (Omit/Pick/Partial/IntersectionClass) all funnel through copyClassProperties, which
// copies runtime property descriptors AND @Property validation metadata via raw prototype/reflect
// manipulation (Object.getOwnPropertyDescriptor / Reflect metadata, not just a type-level Omit/Pick).
// The most realistic way to prove that actually works end to end is to run the resulting classes
// through the real validation pipeline, the same way a real @Body() would.
class Base {
    @Property.string()
    name!: string;

    @Property.number({ required: false })
    age?: number;

    @Property.string()
    secret!: string;
}

class OtherBase {
    @Property.boolean()
    active!: boolean;
}

// eslint-disable-next-line typescript/no-explicit-any
function bodyMeta(modelClass: new (...args: any[]) => unknown, allowAdditionalProperties: boolean = false): BodyMetadata {
    return {
        modelClass,
        type: MimeType.JSON,
        isArray: false,
        allowAdditionalProperties,
        required: true,
        description: undefined,
        index: 0,
        maxSize: NumberUtilities.new(100)
    };
}

describe('copyClassProperties (via OmitClass/PickClass/PartialClass/IntersectionClass)', () => {
    let server: StartedTestServer;
    let validationService: ValidationService;

    beforeAll(async () => {
        server = await startTestServer({});
        validationService = inject(ValidationService);
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    describe('OmitClass', () => {
        class BaseWithoutSecret extends OmitClass(Base, ['secret']) {}

        it('no longer requires the omitted property', async () => {
            const problems: ValidationProblem[] = await validationService.getBodyValidationProblems(
                { name: 'a', age: 1 },
                bodyMeta(BaseWithoutSecret)
            );
            expect(problems).toEqual([]);
        });

        it('still requires the properties that were not omitted', async () => {
            const problems: ValidationProblem[] = await validationService.getBodyValidationProblems(
                { age: 1 },
                bodyMeta(BaseWithoutSecret)
            );
            expect(problems.some(p => p.key === 'name')).toBe(true);
        });

        it('rejects the omitted property as an unknown additional property', async () => {
            const problems: ValidationProblem[] = await validationService.getBodyValidationProblems(
                { name: 'a', secret: 'leaked' },
                bodyMeta(BaseWithoutSecret)
            );
            expect(problems.some(p => p.key === 'secret')).toBe(true);
        });
    });

    describe('PickClass', () => {
        class NameOnly extends PickClass(Base, ['name']) {}

        it('validates successfully with only the picked property', async () => {
            const problems: ValidationProblem[] = await validationService.getBodyValidationProblems(
                { name: 'a' },
                bodyMeta(NameOnly)
            );
            expect(problems).toEqual([]);
        });

        it('rejects properties that were not picked', async () => {
            const problems: ValidationProblem[] = await validationService.getBodyValidationProblems(
                { name: 'a', age: 1 },
                bodyMeta(NameOnly)
            );
            expect(problems.some(p => p.key === 'age')).toBe(true);
        });
    });

    describe('PartialClass', () => {
        class PartialBase extends PartialClass(Base) {}

        it('makes every property optional, so an empty object validates successfully', async () => {
            const problems: ValidationProblem[] = await validationService.getBodyValidationProblems({}, bodyMeta(PartialBase));
            expect(problems).toEqual([]);
        });

        it('still validates the type of a property when it is provided', async () => {
            const problems: ValidationProblem[] = await validationService.getBodyValidationProblems(
                { age: 'not-a-number' },
                bodyMeta(PartialBase)
            );
            expect(problems.some(p => p.key === 'age')).toBe(true);
        });
    });

    describe('IntersectionClass', () => {
        class Combined extends IntersectionClass(Base, OtherBase) {}

        it('requires the properties of every base class', async () => {
            const problems: ValidationProblem[] = await validationService.getBodyValidationProblems(
                { name: 'a', secret: 's' },
                bodyMeta(Combined)
            );
            expect(problems.some(p => p.key === 'active')).toBe(true);
        });

        it('validates successfully when properties from all base classes are present', async () => {
            const problems: ValidationProblem[] = await validationService.getBodyValidationProblems(
                { name: 'a', secret: 's', active: true },
                bodyMeta(Combined)
            );
            expect(problems).toEqual([]);
        });
    });
});