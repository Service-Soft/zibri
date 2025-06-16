import { GlobalRegistry } from '../../global';
import { Newable } from '../../types';
import { MetadataUtilities } from '../../utilities';
import { BaseEntity } from '../models';

export type EntityMetadata = {
    tableName: string
};

export function Entity(tableName?: string): ClassDecorator {
    return target => {
        const metadata: EntityMetadata = {
            tableName: tableName ?? target.name.toLowerCase()
        };
        MetadataUtilities.setEntityMetadata(target as unknown as Newable<BaseEntity>, metadata);
        GlobalRegistry.entityClasses.push(target as unknown as Newable<BaseEntity>);
    };
}