/**
 * What kind of work a span covers.
 *
 * What it decides is how a trace is drawn: a server span and the client span that caused it are two
 * views of one hop, and a viewer that knows which is which can put them on top of each other rather
 * than side by side.
 */
export enum TraceSpanKind {
    /**
     * Work this process does because something outside asked for it - a request it answers.
     */
    SERVER = 'server',
    /**
     * Work something outside does because this process asked - a request it makes.
     */
    CLIENT = 'client',
    /**
     * Work inside this process that nothing outside it is waiting on by name.
     */
    INTERNAL = 'internal',
    /**
     * A message handed to something that will pick it up later.
     */
    PRODUCER = 'producer',
    /**
     * A message picked up that something handed over earlier.
     */
    CONSUMER = 'consumer'
}