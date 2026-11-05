import { Property } from 'zibri';

import { PetstoreCategory } from './petstore.category.model';
import { PetstoreTag } from './petstore.tag.model';

export class PetstorePet {

    @Property.number({ required: false })
    'id'?: number;

    @Property.object({ required: false, cls: () => PetstoreCategory })
    'category'?: PetstoreCategory;

    @Property.string()
    'name'!: string;

    @Property.array({ items: { type: 'string' } })
    'photoUrls'!: string[];

    @Property.array({ required: false, items: { type: 'object', cls: () => PetstoreTag } })
    'tags'?: PetstoreTag[];

    @Property.string({ required: false })
    'status'?: 'available' | 'pending' | 'sold';
}