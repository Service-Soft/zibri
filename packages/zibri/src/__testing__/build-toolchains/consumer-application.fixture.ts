import { BaseEntity, BigNumber, Controller, Entity, Get, HttpStatus, Inject, Injectable, MetadataUtilities, Param, Property, inject, initDiContainer } from 'zibri';

/**
 * What an application declares, written the way a consumer writes it.
 *
 * This file is compiled by the test beside it with one toolchain after another and loaded in a
 * process of its own, so every decorator here is read off whatever that toolchain emitted rather
 * than off the one the framework happens to be built with. It imports the framework by its own name
 * for the same reason: a consumer gets the published package, and the question is what their
 * compiler does to their code.
 *
 * Everything is named with `@Inject`, which is the style that needs no type metadata. The one place
 * that does is declared inside a function further down, so a build carrying the metadata can reach
 * it without a build that does not failing to load at all.
 */

/**
 * Something to inject, so that resolving a dependency is a real resolution.
 */
@Injectable()
export class GreetingService {

    /**
     * Hands back the greeting, so a caller that got the right instance can say so.
     * @returns The greeting.
     */
    greet(): string {
        return 'hello';
    }
}

/**
 * A service that names what it wants, which is the style every toolchain supports.
 */
@Injectable()
export class TaggedService {
    constructor(@Inject(GreetingService) private readonly greeting: GreetingService) {}

    /**
     * Passes the injected greeting through, so an assertion reaches the instance the container built.
     * @returns The greeting.
     */
    greet(): string {
        return this.greeting.greet();
    }
}

/**
 * A service that lets the compiler say what it wants, which is the style that needs the metadata.
 */
@Injectable()
export class UntaggedService {
    constructor(private readonly greeting: GreetingService) {}

    /**
     * Passes the injected greeting through.
     * @returns The greeting.
     */
    greet(): string {
        return this.greeting.greet();
    }
}

/**
 * A service taking a value typed as an enum from another module, without naming a token. Nothing can
 * inject an enum value, but what each compiler records for the parameter differs: tsc writes Number,
 * swc and oxc write the enum object itself.
 */
@Injectable()
export class EnumParameterService {
    constructor(readonly status: HttpStatus) {}
}

/**
 * A parent naming what its constructor wants, and declaring nothing else.
 */
abstract class NamingGreetingBase {
    constructor(@Inject(GreetingService) readonly greeting: GreetingService) {}
}

/**
 * A service built with the constructor it inherits, which names its tokens.
 */
@Injectable()
export class InheritingService extends NamingGreetingBase {}

/**
 * A parent letting the compiler say what its constructor wants.
 */
abstract class UntaggedGreetingBase {
    constructor(readonly greeting: GreetingService) {}
}

/**
 * A service declaring a constructor that takes nothing, and passing its parent what it needs itself.
 */
@Injectable()
export class SelfSupplyingService extends UntaggedGreetingBase {
    constructor() {
        super(new GreetingService());
    }
}

/**
 * An entity, so that the decorators which write their own metadata are covered too.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
export class Invoice extends BaseEntity {

    /**
     * What the invoice is called.
     */
    @Property.string()
    reference!: string;

    /**
     * What it comes to, held exactly.
     */
    @Property.number({ format: 'bignumber' })
    total!: BigNumber;

    /**
     * The status the invoice was last answered with, typed as an enum from another module. A compiler
     * that sees only this file cannot know that the enum holds numbers, so what it records for the
     * property differs: tsc writes Object, swc and oxc write the enum object itself.
     */
    @Property.number({ format: 'integer' })
    lastStatus!: HttpStatus;
}

/**
 * A controller, whose routes and route parameters are decorators of a third and fourth shape.
 */
@Controller('/invoices')
export class InvoiceController {
    constructor(@Inject(GreetingService) private readonly greeting: GreetingService) {}

    /**
     * Reads one invoice.
     * @param reference - Which invoice to read.
     * @returns The reference, and the greeting the injected service hands over.
     */
    @Get('/:reference')
    read(
        @Param.path('reference', { type: 'string' })
        reference: string
    ): { reference: string, greeting: string } {
        return { reference, greeting: this.greeting.greet() };
    }
}

/**
 * Declares a property whose type contradicts the format it names.
 *
 * Inside a function because the contradiction is refused at declaration time, and a build that
 * carries type metadata would therefore refuse this module as it loads. Calling it is what asks the
 * question.
 * @throws When the toolchain wrote down the declared type and it is the wrong one.
 */
export function declareContradictedNumber(): void {
    /**
     * An amount held exactly, declared as something that cannot hold it.
     */
    @Entity({ tenant: 'shared', allowOrphan: true })
    class ContradictedInvoice extends BaseEntity {

        /**
         * What it comes to.
         */
        @Property.number({ format: 'bignumber' })
        total!: number;
    }
    // referenced so that nothing can drop the declaration as unused
    if (ContradictedInvoice.name === '') {
        throw new Error('unreachable');
    }
}

/**
 * What resolving a service did: the error it failed with, or `it resolved` and what it answered.
 */
export type ResolutionOutcome = {
    /**
     * The name of the error, or `it resolved`.
     */
    name: string,
    /**
     * The error's message, or what the resolved service answered.
     */
    message: string
};

/**
 * What the loaded application can be asked about itself.
 */
export type ProbeResult = {
    /**
     * What a service resolved through a named token answered.
     */
    tagged: string,
    /**
     * What resolving a service that named nothing did.
     */
    untagged: ResolutionOutcome,
    /**
     * What resolving a service that inherits a constructor naming its tokens did.
     */
    inherited: ResolutionOutcome,
    /**
     * What resolving a service that declares a constructor taking nothing, below a parent whose
     * constructor takes something, did.
     */
    ownEmptyConstructor: ResolutionOutcome,
    /**
     * What resolving a service whose constructor takes an enum value without naming a token did.
     */
    enumParameter: ResolutionOutcome,
    /**
     * The properties the entity's metadata carries.
     */
    entityProperties: string[],
    /**
     * The routes the controller registered, as method and path.
     */
    routes: string[],
    /**
     * What the controller's own route answered when called through the resolved instance.
     */
    handler: { reference: string, greeting: string },
    /**
     * What declaring a number property against the wrong type did.
     */
    contradictedFormat: string
};

/**
 * Resolves a service and asks it for its greeting.
 * @param read - Resolves the service and reads the greeting.
 * @returns What happened.
 */
function resolveOutcome(read: () => string): ResolutionOutcome {
    try {
        return { name: 'it resolved', message: read() };
    }
    catch (error) {
        const failure: Error = error as Error;
        return { name: failure.name, message: failure.message };
    }
}

/**
 * Asks the loaded application everything the toolchain could have changed.
 * @returns The answers, in a shape the test can compare across toolchains.
 */
export function probe(): ProbeResult {
    initDiContainer();

    let contradictedFormat: string = 'it was accepted';
    try {
        declareContradictedNumber();
    }
    catch (error) {
        contradictedFormat = (error as Error).message;
    }

    const controller: InvoiceController = inject(InvoiceController);

    return {
        tagged: inject(TaggedService).greet(),
        untagged: resolveOutcome(() => inject(UntaggedService).greet()),
        inherited: resolveOutcome(() => inject(InheritingService).greeting.greet()),
        ownEmptyConstructor: resolveOutcome(() => inject(SelfSupplyingService).greeting.greet()),
        enumParameter: resolveOutcome(() => String(inject(EnumParameterService).status)),
        entityProperties: Object.keys(MetadataUtilities.getModelProperties(Invoice)),
        routes: MetadataUtilities.getControllerRoutes(InvoiceController)
            .map(route => `${route.httpMethod} ${route.route}`),
        handler: controller.read('inv-1'),
        contradictedFormat: contradictedFormat
    };
}