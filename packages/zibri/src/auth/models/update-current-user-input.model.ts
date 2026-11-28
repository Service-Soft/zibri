import { Property } from '../../entity/decorators/property.decorator';
import { type LocaleCode } from '../../localization/models/locale-code.model';

/**
 * What `PATCH /me` changes of the logged in user. A value left out stays as it is.
 */
export class UpdateCurrentUserInput {
    /**
     * The locale the mails of the framework reach the user in, one the application supports, such as `de`, or null
     * for the default locale.
     */
    @Property.string({ required: false })
    locale?: LocaleCode | null;
}