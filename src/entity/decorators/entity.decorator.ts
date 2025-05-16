import { BaseEntity } from '../../data-source';
import { GlobalRegistry } from '../../global';
import { Newable } from '../../types';
import { MetadataUtilities } from '../../utilities';

export type EntityMetadata = {
    tableName: string
};

export function Entity(tableName?: string): ClassDecorator {
    return target => {
        const metadata: EntityMetadata = {
            tableName: tableName ?? target.name.toLowerCase()
        };
        MetadataUtilities.setEntityMetadata(metadata, target);
        GlobalRegistry.entityClasses.push(target as unknown as Newable<BaseEntity>);
    };
}