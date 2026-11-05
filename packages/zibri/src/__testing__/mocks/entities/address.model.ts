import { faker } from '@faker-js/faker';

import { Property } from '../../../entity/decorators/property.decorator';

export class Address {
    @Property.string()
    street!: string;

    @Property.string()
    city!: string;
}

export function mockAddress(): Address {
    return {
        city: faker.location.city(),
        street: faker.location.street()
    };
}