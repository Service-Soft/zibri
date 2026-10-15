import { BaseEntity, Entity, File, MimeType, OmitClass, PartialClass, Property } from 'zibri';

@Entity()
export class Test extends BaseEntity {
    // the company the row belongs to
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    @Property.string({ minLength: 28, encryption: true })
    value!: string;
}

export class TestCreateDTO extends OmitClass(Test, ['id', 'tenantId']) {
    @Property.file({ allowedMimeTypes: [MimeType.JSON] })
    file!: File;
}

export class TestUpdateDTO extends PartialClass(OmitClass(Test, ['id', 'tenantId'])) {}