import { HttpClientCircuitBreakerOptions } from './http-client-circuit-breaker-options.model';

/**
 * Where one origin stands.
 */
type Circuit = {
    /**
     * How many requests in a row failed.
     */
    failures: number,
    /**
     * Until when the circuit refuses requests, or undefined while it is closed.
     */
    openUntil?: number,
    /**
     * Whether the one request let through after the circuit was open is still out.
     */
    trialInFlight: boolean
};

/**
 * The circuits of every origin one http client sends to.
 *
 * In this instance's memory rather than shared: every instance calling a dependency that is down
 * finds out within a few requests of its own, and a breaker kept in a store would stop outbound
 * calls whenever the store is down.
 */
export class CircuitBreaker {
    private readonly circuits: Map<string, Circuit> = new Map();

    constructor(private readonly options: HttpClientCircuitBreakerOptions) {}

    /**
     * Lets a request to the origin through, or refuses it while the origin's circuit is open.
     *
     * Once the circuit has been open for `openForMs`, exactly one request is let through, and the
     * others are refused until its outcome is recorded.
     * @param origin - The origin the request goes to.
     * @returns When the next request is let through, or undefined when this one is.
     */
    admit(origin: string): Date | undefined {
        const circuit: Circuit | undefined = this.circuits.get(origin);
        if (circuit?.openUntil == undefined) {
            return undefined;
        }
        if (circuit.trialInFlight || circuit.openUntil > Date.now()) {
            // while a trial is out, a request goes through once it has answered, which nothing here
            // can put a time on - so it says now
            return new Date(Math.max(circuit.openUntil, Date.now()));
        }
        circuit.trialInFlight = true;
        return undefined;
    }

    /**
     * Records that the origin answered, which closes its circuit.
     * @param origin - The origin.
     */
    recordAnswer(origin: string): void {
        this.circuits.delete(origin);
    }

    /**
     * Records that a request to the origin failed, which opens its circuit once enough failed in a
     * row, and again at once when it was the trial.
     * @param origin - The origin.
     */
    recordFailure(origin: string): void {
        const circuit: Circuit = this.circuits.get(origin) ?? { failures: 0, trialInFlight: false };
        circuit.failures++;
        if (circuit.trialInFlight || circuit.failures >= this.options.failuresToOpen) {
            circuit.openUntil = Date.now() + this.options.openForMs;
        }
        circuit.trialInFlight = false;
        this.circuits.set(origin, circuit);
    }

    /**
     * Records that a request let through ended without saying anything about the origin, for example
     * because the request it was sent for had already been answered.
     * @param origin - The origin.
     */
    recordNeither(origin: string): void {
        const circuit: Circuit | undefined = this.circuits.get(origin);
        if (circuit != undefined) {
            // a trial that told nothing frees the place for the next one
            circuit.trialInFlight = false;
        }
    }
}