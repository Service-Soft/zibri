/**
 * How long a route handler is given to produce a result.
 *
 * `'none'` is a statement rather than an omission: it says the handler may take as long as it needs,
 * which is what a long poll or an export that builds a report is for. Leaving the declaration out
 * entirely is the other thing - a route takes whatever its controller says, and a controller that
 * says nothing takes the application's `handlerInMs`.
 */
export type HandlerTimeout = number | 'none';