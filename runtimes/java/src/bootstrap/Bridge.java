package warsha;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.PrintStream;
import java.io.UnsupportedEncodingException;

/**
 * The JS <-> Java bridge. Every native here is implemented in jvm.worker.js as
 * Java_warsha_Bridge_<name>; CheerpJ awaits async natives, so a native that
 * returns a pending promise genuinely parks the Java thread.
 *
 * Nothing in this class may call System.exit(). One CheerpJ JVM serves many
 * runs (the worker is reused), and exiting it would strand every later run in
 * the same session. Status is reported through natives instead.
 */
public class Bridge {

    /** Blocks until the UI submits a line. Returns null for EOF. */
    public static native String readLine();

    /** Program output. One call per write, no buffering -- see installStdout. */
    public static native void writeOut(String s);

    public static native void writeErr(String s);

    /**
     * Compiler output. A separate channel from writeErr so the runtime can
     * rewrite compiler paths without touching anything the program printed.
     */
    public static native void writeDiag(String s);

    /**
     * Terminal status of a bootstrap phase. `phase` is "compile" or "run",
     * `code` is "0" for success or a non-zero exit code. Reported through a
     * native rather than a process exit code, because a real exit would kill
     * the shared JVM.
     */
    public static native void phaseDone(String phase, String code);

    public static void installStdin() {
        System.setIn(new InputStream() {
            private byte[] buf = new byte[0];
            private int pos = 0;
            private boolean eof = false;

            /** True if a byte is available; false at end of input. */
            private boolean fill() throws IOException {
                while (pos >= buf.length) {
                    if (eof) return false;
                    String line = readLine();
                    if (line == null) {
                        eof = true;
                        return false;
                    }
                    buf = (line + "\n").getBytes("UTF-8");
                    pos = 0;
                }
                return true;
            }

            @Override
            public int read() throws IOException {
                if (!fill()) return -1;
                return buf[pos++] & 0xFF;
            }

            /**
             * MUST be overridden. InputStream's default bulk read loops on
             * read() until it has len bytes or hits EOF, so Scanner's 1024-byte
             * request would keep asking the student for more lines and the
             * program would never advance past its first prompt. Returning only
             * what is already buffered is the real console semantic.
             */
            @Override
            public int read(byte[] b, int off, int len) throws IOException {
                if (len == 0) return 0;
                if (!fill()) return -1;
                int n = Math.min(len, buf.length - pos);
                System.arraycopy(buf, pos, b, off, n);
                pos += n;
                return n;
            }

            @Override
            public int available() {
                return buf.length - pos;
            }
        });
    }

    /**
     * A worker has no DOM, so CheerpJ's #console element trick is unavailable.
     * Re-pointing the streams at natives is better anyway: it gives real
     * out/err separation and lets us control flushing precisely.
     */
    public static void installStdout() throws UnsupportedEncodingException {
        System.setOut(new PrintStream(new NativeOut(false), true, "UTF-8"));
        System.setErr(new PrintStream(new NativeOut(true), true, "UTF-8"));
    }

    /**
     * Unbuffered on purpose, and load-bearing for the acceptance criterion that
     * a student sees `System.out.print("Name: ")` before the following
     * nextLine() blocks. PrintStream's autoflush only triggers on a newline, so
     * a partial-line prompt would otherwise sit in the buffer until the next
     * println -- which usually arrives after the read has already returned, and
     * the student types blind.
     *
     * If anyone ever wraps this in a BufferedOutputStream for throughput, they
     * must flush before every blocking read or that criterion regresses
     * silently. The harness has a test for exactly this.
     */
    private static final class NativeOut extends OutputStream {
        private final boolean err;
        /** Bytes of a multi-byte character that has not arrived in full yet. */
        private byte[] partial = new byte[0];

        NativeOut(boolean err) {
            this.err = err;
        }

        /**
         * PrintStream reaches this only for a raw System.out.write(int); text
         * goes through the byte-array path below. A single byte of a multi-byte
         * character cannot be decoded on its own, so hold it until the sequence
         * completes rather than emitting a replacement character.
         */
        @Override
        public void write(int b) {
            byte[] next = new byte[partial.length + 1];
            System.arraycopy(partial, 0, next, 0, partial.length);
            next[partial.length] = (byte) b;
            int hold = incompleteTail(next, next.length);
            emit(next, 0, next.length - hold);
            partial = new byte[hold];
            System.arraycopy(next, next.length - hold, partial, 0, hold);
        }

        /**
         * OutputStreamWriter never splits one character across two calls, so
         * whatever arrives here decodes cleanly on its own.
         */
        @Override
        public void write(byte[] b, int off, int len) {
            if (len == 0) return;
            if (partial.length > 0) {
                write(b[off] & 0xFF);
                off++;
                len--;
                if (len == 0) return;
            }
            emit(b, off, len);
        }

        private void emit(byte[] b, int off, int len) {
            if (len <= 0) return;
            String s;
            try {
                s = new String(b, off, len, "UTF-8");
            } catch (UnsupportedEncodingException e) {
                s = new String(b, off, len);
            }
            if (s.isEmpty()) return;
            if (err) writeErr(s);
            else writeOut(s);
        }

        /** Length of the trailing bytes that form a started-but-unfinished character. */
        private static int incompleteTail(byte[] b, int len) {
            // Walk back over continuation bytes (10xxxxxx) to the lead byte.
            int i = len - 1;
            int continuations = 0;
            while (i >= 0 && (b[i] & 0xC0) == 0x80) {
                continuations++;
                i--;
            }
            if (i < 0) return 0; // all continuations: not something we produced
            int lead = b[i] & 0xFF;
            int expected;
            if (lead < 0x80) expected = 1;
            else if ((lead & 0xE0) == 0xC0) expected = 2;
            else if ((lead & 0xF0) == 0xE0) expected = 3;
            else if ((lead & 0xF8) == 0xF0) expected = 4;
            else return 0; // invalid lead byte; let the decoder deal with it
            int have = continuations + 1;
            return have < expected ? have : 0;
        }
    }
}
