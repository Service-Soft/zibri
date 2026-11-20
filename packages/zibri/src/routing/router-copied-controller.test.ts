import { describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { startTestServer } from '../__testing__/test-server/start-test-server.function';
import { DataSourceInterface } from '../data-source/data-sources/data-source.interface';
import { Injectable } from '../di/decorators/injectable.decorator';
import { IntersectionClass } from '../entity/intersection-class.model';
import { OmitClass } from '../entity/omit-class.model';
import { PickClass } from '../entity/pick-class.model';
import { Newable } from '../types/newable.type';
import { Controller } from './decorators/controller.decorator';
import { Get } from './decorators/get.decorator';

// OmitClass, PickClass and IntersectionClass copy the members of a class onto one of their own, whose
// constructor runs none of the class's: what that constructor sets is never there

@Injectable()
class GreetingService {
    greet(): string {
        return 'hello';
    }
}

class GreetingBase {
    constructor(private readonly greetings: GreetingService) {}

    @Get('/greeting')
    greeting(): string {
        return this.greetings.greet();
    }

    @Get('/other')
    other(): string {
        return 'other';
    }
}

class CounterBase {
    protected readonly start: number = 1;

    @Get('/count')
    count(): number {
        return this.start;
    }
}

class StatelessBase {
    @Get('/ping')
    ping(): string {
        return 'pong';
    }
}

@Controller('/picked-greeting', { allowOrphan: true })
class PickedGreetingController extends PickClass(GreetingBase, ['greeting']) {}

@Controller('/counted', { allowOrphan: true })
class CountedController extends OmitClass(CounterBase, []) {}

@Controller('/combined-count', { allowOrphan: true })
class CombinedCountController extends IntersectionClass(StatelessBase, OmitClass(CounterBase, [])) {}

const dataSourceClass: Newable<DataSourceInterface> = createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories });

describe('Router — controllers built with OmitClass, PickClass and IntersectionClass', () => {
    it('refuses to start when a class one is built from takes constructor parameters, and names both', async () => {
        await expect(startTestServer({ controllers: [PickedGreetingController], dataSources: [dataSourceClass] }))
            .rejects.toThrow(/PickedGreetingController.+GreetingBase.+constructor parameters/s);
    }, TestTimeouts.inMemory.start);

    it('refuses to start when a class one is built from sets a property in its constructor, and names it', async () => {
        await expect(startTestServer({ controllers: [CountedController], dataSources: [dataSourceClass] }))
            .rejects.toThrow(/CountedController.+CounterBase.+"start"/s);
    }, TestTimeouts.inMemory.start);

    it('refuses such a class also below another one it was built from', async () => {
        await expect(startTestServer({ controllers: [CombinedCountController], dataSources: [dataSourceClass] }))
            .rejects.toThrow(/CombinedCountController.+CounterBase.+"start"/s);
    }, TestTimeouts.inMemory.start);
});