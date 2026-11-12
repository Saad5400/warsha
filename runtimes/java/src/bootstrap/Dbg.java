package warsha;

import java.lang.reflect.Array;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The Java debugger's in-JVM half. Student sources compiled for a debug run are
 * rewritten (runtimes/java/src/instrument.ts) to call in here:
 *
 *   l(line, file, "a,b", new Object[]{a,b}, this)   before the first statement on a line
 *   s(...)                                          before any later statement on the same line
 *   enter(name, file, line) / thrown(t) / exit()    around every method, constructor and lambda body
 *
 * Dbg keeps the call stack and decides whether to stop. Stopping PARKS the
 * program inside Bridge.debugStop, an async native that CheerpJ awaits exactly
 * like a Scanner read: the worker posts the stop to the page and resolves the
 * native with the shell's next command. "variables:&lt;ref&gt;" is answered from
 * the live object graph (Bridge.debugReply, which also waits for the next
 * command); a step/continue releases the program.
 *
 * Pause and breakpoint edits while RUNNING arrive through Bridge.debugPoll,
 * which is called at most every ~50ms (a native call per line would be far too
 * slow for a 100k-iteration loop).
 *
 * Plain runs never touch this class: nothing calls it unless the sources were
 * instrumented. Single-threaded by design -- hooks from any thread other than
 * the one that ran first are ignored.
 */
public final class Dbg {

    private Dbg() {}

    private static final int NONE = 0, OVER = 1, INTO = 2, OUT = 3;
    private static final long POLL_NS = 50_000_000L;
    private static final int MAX_CHILDREN = 200;

    static final class Frame {
        final String name;
        final int file;
        int line;
        String names;
        Object[] values;
        Object self;

        Frame(String name, int file, int line) {
            this.name = name;
            this.file = file;
            this.line = line;
        }

        Frame copy() {
            Frame f = new Frame(name, file, line);
            f.names = names;
            f.values = values;
            f.self = self;
            return f;
        }
    }

    private static Frame[] stack = new Frame[64];
    private static int depth;
    private static Thread owner;
    private static boolean polled;
    private static long lastPoll;
    private static int counter;

    private static Set<Long> breakpoints = new HashSet<Long>();
    private static int mode = NONE;
    private static int stepDepth;
    private static boolean pauseRequested;
    private static boolean entryPending;
    private static boolean parked;

    /** The exception currently unwinding, and the stack as it was where it was thrown. */
    private static Throwable unwinding;
    private static Frame[] unwindingStack;

    /** ref -> object, valid while parked. Index + 1 is the ref. */
    private static final List<Object> refs = new ArrayList<Object>();

    /** Called by Launcher before every run, debug or not. */
    static void reset() {
        stack = new Frame[64];
        depth = 0;
        owner = null;
        polled = false;
        lastPoll = 0;
        counter = 0;
        breakpoints = new HashSet<Long>();
        mode = NONE;
        stepDepth = 0;
        pauseRequested = false;
        entryPending = false;
        parked = false;
        unwinding = null;
        unwindingStack = null;
        refs.clear();
    }

    // --- hooks ------------------------------------------------------------------

    private static boolean mine() {
        Thread t = Thread.currentThread();
        if (owner == null) owner = t;
        return owner == t && !parked;
    }

    public static void enter(String name, int file, int line) {
        if (!mine()) return;
        if (depth == stack.length) {
            Frame[] bigger = new Frame[stack.length * 2];
            System.arraycopy(stack, 0, bigger, 0, depth);
            stack = bigger;
        }
        stack[depth++] = new Frame(name, file, line);
    }

    public static void exit() {
        if (!mine()) return;
        if (depth > 0) stack[--depth] = null;
    }

    /** Called as `t` leaves an instrumented frame (before exit()). */
    public static void thrown(Throwable t) {
        if (!mine()) return;
        if (unwinding != t) {
            unwinding = t;
            unwindingStack = new Frame[depth];
            for (int i = 0; i < depth; i++) unwindingStack[i] = stack[i].copy();
        }
        if (depth == 1) {
            // Leaving the outermost frame: nothing of the student's catches it.
            Frame[] saved = unwindingStack;
            unwinding = null;
            unwindingStack = null;
            stop("exception", describe(t), saved);
        }
    }

    public static void l(int line, int file, String names, Object[] values, Object self) {
        if (!mine() || depth == 0) return;
        Frame f = stack[depth - 1];
        f.line = line;
        f.names = names;
        f.values = values;
        f.self = self;
        maybePoll();
        String reason = null;
        if (pauseRequested) reason = "pause";
        else if (mode == INTO || (mode == OVER && depth <= stepDepth) || (mode == OUT && depth < stepDepth))
            reason = entryPending ? "entry" : "step";
        else if (!breakpoints.isEmpty() && breakpoints.contains(key(file, line))) reason = "breakpoint";
        if (reason != null) stop(reason, null, null);
    }

    public static void s(int line, int file, String names, Object[] values, Object self) {
        if (!mine() || depth == 0) return;
        Frame f = stack[depth - 1];
        f.line = line;
        f.names = names;
        f.values = values;
        f.self = self;
        maybePoll();
    }

    private static void maybePoll() {
        if (!polled) {
            polled = true;
            poll();
            lastPoll = System.nanoTime();
            return;
        }
        if ((++counter & 31) != 0) return;
        long now = System.nanoTime();
        if (now - lastPoll < POLL_NS) return;
        lastPoll = now;
        poll();
    }

    /** "pause\tentry\tbreakpoints": "1"/"0", "1"/"0", "-" (unchanged) or "file:line,file:line". */
    private static void poll() {
        String control = Bridge.debugPoll();
        if (control == null || control.isEmpty()) return;
        String[] parts = control.split("\t", -1);
        if (parts.length > 0 && parts[0].equals("1")) pauseRequested = true;
        if (parts.length > 1 && parts[1].equals("1")) {
            entryPending = true;
            mode = INTO;
        }
        if (parts.length > 2 && !parts[2].equals("-")) {
            Set<Long> next = new HashSet<Long>();
            for (String bp : parts[2].split(",")) {
                int colon = bp.indexOf(':');
                if (colon <= 0) continue;
                try {
                    next.add(key(Integer.parseInt(bp.substring(0, colon)), Integer.parseInt(bp.substring(colon + 1))));
                } catch (NumberFormatException ignored) {
                    // malformed entry: skip it
                }
            }
            breakpoints = next;
        }
    }

    private static long key(int file, int line) {
        return ((long) file << 32) | (line & 0xffffffffL);
    }

    // --- parking -----------------------------------------------------------------

    private static void stop(String reason, String description, Frame[] frames) {
        if (frames == null) {
            frames = new Frame[depth];
            System.arraycopy(stack, 0, frames, 0, depth);
        }
        mode = NONE;
        pauseRequested = false;
        entryPending = false;
        parked = true;
        refs.clear();
        String command;
        try {
            command = Bridge.debugStop(stoppedJson(reason, description, frames));
            while (command != null && command.startsWith("variables:")) {
                String json;
                try {
                    json = childrenJson(Integer.parseInt(command.substring("variables:".length()).trim()));
                } catch (Throwable t) {
                    json = "[]";
                }
                command = Bridge.debugReply(json);
            }
        } finally {
            refs.clear();
            parked = false;
        }
        if (command == null) command = "continue";
        stepDepth = depth;
        if (command.equals("stepOver")) mode = OVER;
        else if (command.equals("stepInto")) mode = INTO;
        else if (command.equals("stepOut")) mode = OUT;
        else mode = NONE;
        // Breakpoints edited while parked.
        poll();
        lastPoll = System.nanoTime();
    }

    private static String describe(Throwable t) {
        try {
            return Traces.header(t);
        } catch (Throwable ignored) {
            return String.valueOf(t);
        }
    }

    // --- JSON ----------------------------------------------------------------------

    private static String stoppedJson(String reason, String description, Frame[] frames) {
        StringBuilder sb = new StringBuilder();
        sb.append("{\"reason\":").append(str(reason));
        if (description != null) sb.append(",\"description\":").append(str(description));
        sb.append(",\"frames\":[");
        for (int i = frames.length - 1; i >= 0; i--) {
            Frame f = frames[i];
            if (i != frames.length - 1) sb.append(',');
            sb.append("{\"name\":").append(str(f.name))
                    .append(",\"file\":").append(f.file)
                    .append(",\"line\":").append(f.line)
                    .append(",\"locals\":[");
            boolean first = true;
            if (f.names != null && !f.names.isEmpty() && f.values != null) {
                String[] names = f.names.split(",");
                for (int k = 0; k < names.length && k < f.values.length; k++) {
                    if (!first) sb.append(',');
                    first = false;
                    value(sb, names[k], f.values[k]);
                }
            }
            sb.append(']');
            if (f.self != null) {
                sb.append(",\"this\":");
                fieldsJson(sb, f.self);
            }
            sb.append('}');
        }
        sb.append("]}");
        return sb.toString();
    }

    private static String childrenJson(int ref) {
        if (ref < 1 || ref > refs.size()) return "[]";
        Object o = refs.get(ref - 1);
        StringBuilder sb = new StringBuilder();
        if (o.getClass().isArray()) {
            sb.append('[');
            int n = Array.getLength(o);
            for (int i = 0; i < n && i < MAX_CHILDREN; i++) {
                if (i > 0) sb.append(',');
                value(sb, "[" + i + "]", Array.get(o, i));
            }
            sb.append(']');
        } else if (o instanceof Map<?, ?>) {
            sb.append('[');
            int i = 0;
            for (Map.Entry<?, ?> e : ((Map<?, ?>) o).entrySet()) {
                if (i >= MAX_CHILDREN) break;
                if (i++ > 0) sb.append(',');
                value(sb, shortText(e.getKey()), e.getValue());
            }
            sb.append(']');
        } else if (o instanceof Collection<?> && o.getClass().getName().startsWith("java.")) {
            sb.append('[');
            int i = 0;
            for (Object e : (Collection<?>) o) {
                if (i >= MAX_CHILDREN) break;
                if (i > 0) sb.append(',');
                value(sb, "[" + i + "]", e);
                i++;
            }
            sb.append(']');
        } else {
            fieldsJson(sb, o);
        }
        return sb.toString();
    }

    private static void fieldsJson(StringBuilder sb, Object o) {
        sb.append('[');
        int n = 0;
        for (Field field : fields(o.getClass())) {
            if (n >= MAX_CHILDREN) break;
            Object v;
            try {
                v = field.get(o);
            } catch (Throwable t) {
                continue;
            }
            if (n++ > 0) sb.append(',');
            value(sb, field.getName(), v);
        }
        sb.append(']');
    }

    /** Instance fields, superclass first, made readable where the runtime allows it. */
    private static List<Field> fields(Class<?> c) {
        List<Class<?>> chain = new ArrayList<Class<?>>();
        for (Class<?> k = c; k != null && k != Object.class; k = k.getSuperclass()) chain.add(0, k);
        List<Field> out = new ArrayList<Field>();
        for (Class<?> k : chain) {
            Field[] declared;
            try {
                declared = k.getDeclaredFields();
            } catch (Throwable t) {
                continue;
            }
            for (Field f : declared) {
                if (Modifier.isStatic(f.getModifiers()) || f.isSynthetic()) continue;
                try {
                    f.setAccessible(true);
                } catch (Throwable t) {
                    continue;
                }
                out.add(f);
            }
        }
        return out;
    }

    /** One {"name","value","type","ref"} object. */
    private static void value(StringBuilder sb, String name, Object v) {
        sb.append("{\"name\":").append(str(name)).append(",\"value\":").append(str(display(v)));
        if (v != null) sb.append(",\"type\":").append(str(typeName(v)));
        if (expandable(v)) {
            refs.add(v);
            sb.append(",\"ref\":").append(refs.size());
        }
        sb.append('}');
    }

    private static boolean expandable(Object v) {
        if (v == null) return false;
        if (v.getClass().isArray()) return Array.getLength(v) > 0;
        if (v instanceof Collection<?>) return !((Collection<?>) v).isEmpty();
        if (v instanceof Map<?, ?>) return !((Map<?, ?>) v).isEmpty();
        if (isLeaf(v)) return false;
        if (v.getClass().getName().startsWith("java.")) return false;
        return !fields(v.getClass()).isEmpty();
    }

    private static boolean isLeaf(Object v) {
        return v instanceof String || v instanceof Number || v instanceof Boolean || v instanceof Character
                || v instanceof Enum<?> || v instanceof Class<?>;
    }

    private static String typeName(Object v) {
        if (v instanceof Integer) return "int";
        if (v instanceof Long) return "long";
        if (v instanceof Double) return "double";
        if (v instanceof Float) return "float";
        if (v instanceof Boolean) return "boolean";
        if (v instanceof Character) return "char";
        if (v instanceof Short) return "short";
        if (v instanceof Byte) return "byte";
        return simpleName(v.getClass());
    }

    private static String simpleName(Class<?> c) {
        if (c.isArray()) return simpleName(c.getComponentType()) + "[]";
        String simple = c.getSimpleName();
        if (!simple.isEmpty()) return simple;
        String n = c.getName(); // anonymous: Main$1
        int dot = n.lastIndexOf('.');
        return dot >= 0 ? n.substring(dot + 1) : n;
    }

    private static String display(Object v) {
        return display(v, 0);
    }

    private static String display(Object v, int level) {
        if (v == null) return "null";
        if (v instanceof String) return quote((String) v, '"');
        if (v instanceof Character) return quote(String.valueOf(v), '\'');
        if (v instanceof Number || v instanceof Boolean) return String.valueOf(v);
        if (v instanceof Enum<?>) return ((Enum<?>) v).name();
        Class<?> c = v.getClass();
        if (c.isArray()) {
            String component = simpleName(c.getComponentType());
            int n = Array.getLength(v);
            int bracket = component.indexOf('[');
            return bracket >= 0
                    ? component.substring(0, bracket) + "[" + n + "]" + component.substring(bracket)
                    : component + "[" + n + "]";
        }
        if (v instanceof Collection<?>) return simpleName(c) + " size=" + ((Collection<?>) v).size();
        if (v instanceof Map<?, ?>) return simpleName(c) + " size=" + ((Map<?, ?>) v).size();
        if (v instanceof CharSequence) return quote(v.toString(), '"');
        if (c.getName().startsWith("java.")) {
            // Platform VALUE types (LocalDate, UUID, Optional...) say it best
            // themselves; anything else (Scanner, Random...) is just its name.
            String n = c.getName();
            if (n.startsWith("java.time.") || n.equals("java.util.UUID") || n.startsWith("java.util.Optional")) {
                try {
                    return truncate(String.valueOf(v));
                } catch (Throwable t) {
                    return simpleName(c);
                }
            }
            return simpleName(c);
        }
        // Student classes: never call their toString() -- it would run
        // instrumented code while parked.
        if (level > 0) return simpleName(c) + "@" + Integer.toHexString(System.identityHashCode(v));
        StringBuilder sb = new StringBuilder(simpleName(c)).append(" {");
        int n = 0;
        for (Field f : fields(c)) {
            if (n == 4) {
                sb.append(", …");
                break;
            }
            Object fv;
            try {
                fv = f.get(v);
            } catch (Throwable t) {
                continue;
            }
            if (n++ > 0) sb.append(", ");
            sb.append(f.getName()).append('=').append(display(fv, level + 1));
        }
        return truncate(sb.append('}').toString());
    }

    private static String shortText(Object key) {
        return display(key, 1);
    }

    private static String truncate(String s) {
        return s.length() > 200 ? s.substring(0, 199) + "…" : s;
    }

    private static String quote(String s, char q) {
        StringBuilder sb = new StringBuilder().append(q);
        int limit = Math.min(s.length(), 500);
        for (int i = 0; i < limit; i++) {
            char c = s.charAt(i);
            switch (c) {
                case '\n': sb.append("\\n"); break;
                case '\t': sb.append("\\t"); break;
                case '\r': sb.append("\\r"); break;
                case '\\': sb.append("\\\\"); break;
                default:
                    if (c == q) sb.append('\\');
                    sb.append(c);
            }
        }
        if (s.length() > limit) sb.append('…');
        return sb.append(q).toString();
    }

    /** A JSON string literal. */
    private static String str(String s) {
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\\') sb.append('\\').append(c);
            else if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
            else sb.append(c);
        }
        return sb.append('"').toString();
    }
}
