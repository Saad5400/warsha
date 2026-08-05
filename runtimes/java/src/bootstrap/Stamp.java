package warsha;

/**
 * The bootstrap cache stamp, compiled INTO the cached classes rather than kept
 * in a file beside them.
 *
 * The worker replaces VALUE's placeholder with a hash of the exact bootstrap
 * sources (plus the compiler jar path and engine version) before every
 * in-browser bootstrap compile, then passes the same hash to Server.main on
 * every boot. Classes persisted in /files/warsha therefore carry proof of what
 * they were compiled from: a match means this very source set produced them,
 * whoever's session did the compiling; any mismatch — new app deploy, changed
 * ecj.jar, half-written cache — fails the check and triggers a recompile.
 *
 * A separate stamp file was rejected deliberately: it could survive a compile
 * that died halfway and vouch for classes it does not describe. A constant
 * inside the class set can only exist compiled, next to the classes it was
 * compiled with.
 *
 * This committed placeholder is what javac sees offline; it never matches a
 * real hash, so a bootstrap accidentally compiled from it is never cached.
 */
final class Stamp {

    /** Replaced by the worker before compiling; see the class comment. */
    static final String VALUE = "dev-placeholder";

    private Stamp() {
    }
}
