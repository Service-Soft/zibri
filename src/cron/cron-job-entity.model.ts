import { BaseEntity, Entity, Property } from '../entity';
import { OmitStrict } from '../types';

@Entity()
export class CronJobEntity implements BaseEntity {
    @Property.string({ primary: true })
    id!: string;

    @Property.string({ unique: true })
    name!: string;

    @Property.string()
    cron!: string;

    @Property.boolean()
    active!: boolean;

    @Property.boolean()
    runOnInit!: boolean;

    @Property.boolean()
    stopOnError!: boolean;

    @Property.date({ required: false })
    lastRun!: Date | undefined;

    @Property.string({ required: false })
    errorMessage!: string | undefined;
}

export type CreateCronJobEntityData = OmitStrict<CronJobEntity, 'id'>;