import { Property } from '../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator';
import { CamtStatement } from './camt-statement.model';

/**
 * The message of a CAMT.053 file: one statement or more, of one account or several.
 */
export class CamtBankToCustomerStatement {
    /**
     * The statements.
     */
    @XmlElement('Stmt')
    @Property.array({ items: { type: 'object', cls: () => CamtStatement, allowAdditionalProperties: true } })
    statements!: CamtStatement[];
}