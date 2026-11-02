import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Auth } from '../../auth/decorators/auth.decorator';
import { inject } from '../../di/inject.function';
import { XmlAttribute } from '../../parsing/xml/xml-attribute.decorator';
import { BodyMetadata } from '../../routing/decorators/body-metadata.model';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Get } from '../../routing/decorators/get.decorator';
import { resolveBodyMetadata } from '../../routing/resolve-body-metadata.function';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { ValidationProblem } from '../../validation/validation-problem.model';
import { ValidationService } from '../../validation/validation.service';
import { Property } from '../decorators/property.decorator';
import { IntersectionClass } from '../intersection-class.model';
import { OmitClass } from '../omit-class.model';
import { PartialClass } from '../partial-class.model';
import { PickClass } from '../pick-class.model';

// These helpers (Omit/Pick/Partial/IntersectionClass) all funnel through ClassPropertyUtilities.copy,
// which copies runtime property descriptors AND @Property validation metadata via raw prototype/reflect
// manipulation (Object.getOwnPropertyDescriptor / Reflect metadata, not just a type-level Omit/Pick).
// The most realistic way to prove that actually works end to end is to run the resulting classes
// through the real validation pipeline, the same way a real @Body() would.
class Address {
    @Property.string()
    street!: string;
}

class Base {
    @Property.string()
    name!: string;

    @Property.number({ required: false })
    age?: number;

    @Property.string()
    secret!: string;

    @Property.object({ cls: () => Address, required: false })
    address?: Address;
}

class OtherBase {
    @Property.boolean()
    active!: boolean;
}

class FirstBase {
    @Auth.skip()
    @Get('/first')
    shared(): { from: string } {
        return { from: 'first' };
    }
}

class SecondBase {
    @Get('/second')
    shared(): { from: string } {
        return { from: 'second' };
    }
}

@Controller('/combined')
class CombinedController extends IntersectionClass(FirstBase, SecondBase) {}

@Auth.isLoggedIn()
class GuardedBase {
    @Get('/stats')
    stats(): { from: string } {
        return { from: 'guarded' };
    }

    @Auth.skip()
    @Get('/health')
    health(): { from: string } {
        return { from: 'guarded' };
    }
}

@Controller('/picked')
class PickedController extends PickClass(GuardedBase, ['stats', 'health']) {}

// eslint-disable-next-line typescript/no-explicit-any
function bodyMeta(modelClass: new (...args: any[]) => unknown, allowAdditionalProperties: boolean = false): BodyMetadata {
    return resolveBodyMetadata({ modelClass, allowAdditionalProperties }, 0);
}

describe('ClassPropertyUtilities (via OmitClass/PickClass/PartialClass/IntersectionClass)', () => {
    let server: StartedTestServer;
    let baseUrl: string;
    let validationService: ValidationService;

    beforeAll(async () => {
        server = await startTestServer({
            controllers: [CombinedController, PickedController],
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })]
        });
        baseUrl = await server.start();
        validationService = inject(ValidationService);
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

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

        it('builds a class of its own, so an instance is not one of the base', () => {
            expect(new BaseWithoutSecret() instanceof Base).toBe(false);
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

        it('builds a class of its own, so an instance is not one of the base', () => {
            expect(new NameOnly() instanceof Base).toBe(false);
        });
    });

    describe('PartialClass', () => {
        class PartialBase extends PartialClass(Base) {}

        it('makes every property optional, so an empty object validates successfully', async () => {
            const problems: ValidationProblem[] = await validationService.getBodyValidationProblems({}, bodyMeta(PartialBase));
            expect(problems).toEqual([]);
        });

        it('refuses null for a property the base requires, and takes it where the base does not', async () => {
            const problems: ValidationProblem[] = await validationService.getBodyValidationProblems(
                // eslint-disable-next-line unicorn/no-null
                { name: null, age: null },
                bodyMeta(PartialBase)
            );
            expect(problems.map(p => p.key)).toEqual(['name']);
        });

        it('still validates the type of a property when it is provided', async () => {
            const problems: ValidationProblem[] = await validationService.getBodyValidationProblems(
                { age: 'not-a-number' },
                bodyMeta(PartialBase)
            );
            expect(problems.some(p => p.key === 'age')).toBe(true);
        });

        it('leaves what a nested model declares, so a value given for it holds what that model requires', async () => {
            const problems: ValidationProblem[] = await validationService.getBodyValidationProblems(
                { address: {} },
                bodyMeta(PartialBase)
            );
            expect(problems.some(p => p.key.includes('street'))).toBe(true);
        });

        it('extends the base, so an instance is one of it', () => {
            expect(new PartialBase() instanceof Base).toBe(true);
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

        it('builds a class of its own, so an instance is one of no base', () => {
            const combined: Combined = new Combined();
            expect(combined instanceof Base).toBe(false);
            expect(combined instanceof OtherBase).toBe(false);
        });

        // the routes of the bases were concatenated, so a method two bases share was
        // registered under the route of each, the last base's implementation answering the first
        // base's path as well
        it('serves a method two bases share from the last base naming it, under its route alone', async () => {
            expect(MetadataUtilities.getControllerRoutes(CombinedController).map(r => r.controllerMethod)).toEqual(['shared']);

            const second: Response = await fetch(`${baseUrl}/combined/second`);
            expect(second.status).toBe(200);
            expect(await second.json()).toEqual({ from: 'second' });
            const first: Response = await fetch(`${baseUrl}/combined/first`);
            expect(first.status).toBe(404);
        });

        it('serves a method two bases share with the declarations of the last base alone', () => {
            expect(MetadataUtilities.getRouteSkipAuth(CombinedController, 'shared')).toBeUndefined();
        });
    });

    describe('xml declarations', () => {
        class XmlOrder {
            @XmlAttribute()
            @Property.string()
            id!: string;

            @Property.string()
            note!: string;
        }

        it('keeps how each property it takes over is written in xml', () => {
            class XmlOrderDto extends OmitClass(XmlOrder, ['note']) {}

            expect(MetadataUtilities.getXmlProperties(XmlOrderDto)['id']).toEqual(MetadataUtilities.getXmlProperties(XmlOrder)['id']);
            expect(MetadataUtilities.getXmlProperties(XmlOrderDto)['note']).toBeUndefined();
        });
    });

    describe('a controller built from one with checks on the class', () => {
        it('keeps the checks of the class on every route it takes over', async () => {
            const response: Response = await fetch(`${baseUrl}/picked/stats`);
            expect(response.status).toBe(401);
        });

        it('keeps a route that skips them open', async () => {
            const response: Response = await fetch(`${baseUrl}/picked/health`);
            expect(response.status).toBe(200);
        });
    });
});