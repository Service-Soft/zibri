import { describe, expect, it } from '@jest/globals';

import { Auth } from './auth.decorator';
import { TestPermissions, TestPlatformPermissions } from '../../__testing__/mocks/entities/test-permissions.model';
import { InvalidDecoratorCombinationError } from '../../error-handling/errors/invalid-decorator-combination.error';
import { Controller } from '../../routing/decorators/controller.decorator';
import { Get } from '../../routing/decorators/get.decorator';

/**
 * A route names one permission. The decorator stores a single one, so a second on the same route or
 * controller replaced the first without a word: written as "this and that", it checked only one of
 * the two.
 */
describe('a permission decorator', () => {

    it('refuses a second tenant permission on the same route', () => {
        expect(() => {
            @Controller('/stacked-route', { allowOrphan: true })
            class StackedRouteController {
                @Auth.hasPermission(TestPermissions.MEMBER_ADMIN)
                @Auth.hasPermission(TestPermissions.MEMBER_USER)
                @Get()
                list(): void {}
            }
            return StackedRouteController;
        }).toThrow(InvalidDecoratorCombinationError);
    });

    it('refuses a second tenant permission on the same controller', () => {
        expect(() => {
            @Auth.hasPermission(TestPermissions.MEMBER_ADMIN)
            @Auth.hasPermission(TestPermissions.MEMBER_USER)
            @Controller('/stacked-controller', { allowOrphan: true })
            class StackedControllerController {}
            return StackedControllerController;
        }).toThrow(InvalidDecoratorCombinationError);
    });

    it('refuses a second platform permission on the same route', () => {
        expect(() => {
            @Controller('/stacked-platform-route', { allowOrphan: true })
            class StackedPlatformRouteController {
                @Auth.hasPlatformPermission(TestPlatformPermissions.ADMIN)
                @Auth.hasPlatformPermission(TestPlatformPermissions.USER)
                @Get()
                list(): void {}
            }
            return StackedPlatformRouteController;
        }).toThrow(InvalidDecoratorCombinationError);
    });

    it('takes a tenant and a platform permission on one route, and a route\'s own beside the controller\'s', () => {
        expect(() => {
            @Auth.hasPermission(TestPermissions.MEMBER_USER)
            @Controller('/both-levels', { allowOrphan: true })
            class BothLevelsController {
                @Auth.hasPermission(TestPermissions.MEMBER_ADMIN)
                @Auth.hasPlatformPermission(TestPlatformPermissions.ADMIN)
                @Get()
                list(): void {}
            }
            return BothLevelsController;
        }).not.toThrow();
    });
});