/**
 * How long an instance of a test cluster may take to boot before the cluster gives up on it.
 *
 * Instances boot one after the other unless the cluster boots them all at once, so a hook that starts
 * a cluster needs the time its containers take to start, plus this once per instance.
 */
// the instance compiles the framework's sources as it loads them, which alone takes 3.6 seconds on a
// fast machine, before the application boots against the shared database. A ci runner is several
// times slower, and instances booting at once share its cores: 15 seconds gave up on instances that
// were most of the way through.
//
// A module of its own, importing nothing, so that the framework's test timeouts can read it without
// loading the harness into every suite that needs a timeout
export const clusterInstanceBootTimeoutInMs: number = 45000;