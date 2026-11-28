import { EntityWriteObserver, ObservedWrite, RowWrite } from '../../data-source/write-observers/entity-write-observer.model';
import { EntityWriteObserverRegistry } from '../../data-source/write-observers/entity-write-observer.registry';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { inject } from '../../di/inject.function';
import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { OnAppInit } from '../../global/on-app-init.interface';
import { $ts } from '../../localization/translate.function';
import { BookkeepingStatementUtilities } from './bookkeeping-statement.utilities';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from './bookkeeping.tokens';
import { BookkeepingAccountType } from './models/bookkeeping-account-type.enum';
import { BookkeepingAccount } from './models/bookkeeping-account.model';
import { BookkeepingStatementType } from './models/bookkeeping-statement-type.enum';

/**
 * The properties of an account its mapping to the statements is judged by.
 */
const MAPPING_PROPERTIES: (keyof BookkeepingAccount)[] = ['type', 'statementPosition', 'creditStatementPosition'];

/**
 * Keeps the mapping of each account to the statements valid, however the repository got to the write, such as a seed
 * of a chart of accounts: each position it names is one of the full statement structures that accounts are mapped
 * to, of the statement of its type.
 */
@Injectable({ register: 'onUse' })
export class BookkeepingAccountWriteObserver implements EntityWriteObserver, OnAppInit {
    /**
     * What an account changed by a write to every account a filter matches is read with.
     */
    readonly properties: string[] = MAPPING_PROPERTIES;

    /**
     * Registers itself as an observer of every write to an account.
     */
    onAppInit(): void {
        inject(EntityWriteObserverRegistry).register(BookkeepingAccount, this);
    }

    /**
     * Refuses a write that maps an account to a position no full statement structure has, to one accounts are not
     * mapped to, or to one of the other statement than its type is reported in.
     * @param write - The write about to be made.
     * @throws A BadRequestError naming the first position that is not valid.
     */
    async validateWrite(write: ObservedWrite): Promise<void> {
        if (
            write.operation === 'remove'
            || !write.data.some(data => MAPPING_PROPERTIES.some(key => Reflect.get(data, key) !== undefined))
        ) {
            return;
        }
        const positions: Map<string, BookkeepingStatementType> = BookkeepingStatementUtilities.resolveMappablePositions(
            inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.STATEMENT_STRUCTURES)
        );
        const rows: RowWrite[] = await write.resolveRowWrites();
        for (const row of rows) {
            if (row.data == undefined) {
                continue;
            }
            const type: unknown = Reflect.get(row.data, 'type')
                ?? (row.existing == undefined ? undefined : Reflect.get(row.existing, 'type'));
            for (const key of ['statementPosition', 'creditStatementPosition'] as const) {
                const written: unknown = Reflect.get(row.data, key);
                const position: unknown = written === undefined && row.existing != undefined ? Reflect.get(row.existing, key) : written;
                if (typeof position === 'string') {
                    this.validatePosition(key, position, type, positions);
                }
            }
        }
    }

    /**
     * Validates a position an account is mapped to.
     * @param key - The property naming it.
     * @param position - The id of the position.
     * @param type - The type of the account.
     * @param positions - The positions accounts are mapped to, with the type of their statement.
     * @throws A BadRequestError when it is not valid.
     */
    private validatePosition(key: string, position: string, type: unknown, positions: Map<string, BookkeepingStatementType>): void {
        const statement: BookkeepingStatementType | undefined = positions.get(position);
        if (statement == undefined) {
            throw new BadRequestError(
                $ts`The ${key} "${position}" needs to be a position of a full statement without positions below it, such as assets.B.IV.`
            );
        }
        const accountType: BookkeepingAccountType | undefined = Object.values(BookkeepingAccountType).find(value => value === type);
        if (accountType == undefined || BookkeepingStatementUtilities.resolveStatementType(accountType) === statement) {
            return;
        }
        throw new BadRequestError(statement === BookkeepingStatementType.INCOME_STATEMENT
            ? $ts`The ${key} "${position}" of an asset, liability or equity account needs to be a position of a balance sheet.`
            : $ts`The ${key} "${position}" of a revenue or expense account needs to be a position of an income statement.`);
    }
}