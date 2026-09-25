/**
 * A value a span attribute can hold.
 *
 * Scalars and arrays of one scalar type, which is what every tracing backend stores. Nested objects
 * are not in the list on purpose: what a backend does with one is flatten it into keys nobody chose,
 * so a span carrying a structure is better off naming the parts it wants indexed.
 */
export type TraceSpanAttributeValue = string | number | boolean | string[] | number[] | boolean[];

/**
 * The name of a span attribute.
 *
 * The listed ones are what the framework writes itself, spelled the way the OpenTelemetry semantic
 * conventions spell them so that a backend renders them as the fields it already knows. Any other
 * string is accepted - these are the ones you get suggested.
 */
export type TraceSpanAttributeName
    = | 'http.request.method'
        | 'http.request.resend_count'
        | 'http.response.status_code'
        | 'http.route'
        | 'url.full'
        | 'url.path'
        | 'url.scheme'
        | 'server.address'
        | 'client.address'
        | 'user_agent.original'
        | 'error.type'
        | 'db.system'
        | 'db.operation.name'
        | 'db.collection.name'
        | 'db.response.returned_rows'
        | 'cache.name'
        | 'cache.operation'
        | 'cache.hit'
        | 'code.function'
        | 'messaging.destination.name'
        | 'messaging.message.id'
        | string & {};

/**
 * What a span records besides its name and how long it took.
 *
 * An undefined value is left off rather than written as nothing, so a caller can list everything it
 * might know and let the ones it does not simply not appear.
 */
export type TraceSpanAttributes = Partial<Record<TraceSpanAttributeName, TraceSpanAttributeValue | undefined>>;