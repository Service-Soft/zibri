import { BaseEntity, Entity, File, MimeType, OmitClass, PartialClass, Property } from 'zibri';

@Entity()
export class Test extends BaseEntity {
    @Property.string({ minLength: 28, encryption: true })
    value!: string;
}

export class TestCreateDTO extends OmitClass(Test, ['id']) {
    @Property.file({ allowedMimeTypes: [MimeType.JSON] })
    file!: File;
}

export class TestUpdateDTO extends PartialClass(OmitClass(Test, ['id'])) {}