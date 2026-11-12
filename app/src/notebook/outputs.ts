/**
 * How a running cell's output list grows — the frontend half of Jupyter's
 * output model, as pure functions over nbformat output objects:
 *   - consecutive writes to one stream merge into one `stream` output (a loop
 *     of print()s is one block, not a thousand);
 *   - a carriage return rewrites its line, so a progress bar (`\r 40%`)
 *     stays one line instead of a scroll of every frame;
 *   - `update` replaces the output carrying the same display id in place;
 *   - `clear_output(wait=True)` clears when the next output arrives.
 */
import { joinText, type NbOutput } from './nbformat'

/** Fold carriage returns the way a terminal shows them: `a\rb` → `b`, `\r\n` stays a newline. */
export function foldCarriageReturns(text: string): string {
  if (!text.includes('\r')) return text
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      if (!line.includes('\r')) return line
      // Each \r returns to column 0; later text overwrites earlier text from there.
      let out = ''
      for (const part of line.split('\r')) out = part + out.slice(part.length)
      return out
    })
    .join('\n')
}

/** A stream keeps at most this much text; past it the oldest lines are dropped, as the console does. */
export const STREAM_LIMIT = 1_000_000
export const TRIMMED_NOTE = '[Warsha: earlier output was trimmed to keep this cell responsive]\n'

/**
 * Add a chunk to a stream text. Complete lines are folded (carriage returns
 * resolved) as they complete; the OPEN last line stays raw, because a progress
 * bar's `\r` frames can arrive one chunk at a time — folding each chunk alone
 * glued them together ("0%1%2%done"). Only the new region is touched, so a
 * print loop costs O(chunk), not O(everything printed so far).
 */
export function appendStreamText(prev: string, chunk: string): string {
  const stableEnd = prev.lastIndexOf('\n') + 1
  const tail = prev.slice(stableEnd) + chunk
  const cut = tail.lastIndexOf('\n') + 1
  let text = prev.slice(0, stableEnd) + foldCarriageReturns(tail.slice(0, cut)) + tail.slice(cut)
  if (text.length > STREAM_LIMIT) {
    if (text.startsWith(TRIMMED_NOTE)) text = text.slice(TRIMMED_NOTE.length)
    const from = text.indexOf('\n', text.length - Math.floor(STREAM_LIMIT * 0.8))
    text = TRIMMED_NOTE + text.slice(from < 0 ? text.length - Math.floor(STREAM_LIMIT * 0.8) : from + 1)
  }
  return text
}

/** What a stream shows: its text with the open line's carriage returns resolved too. */
export function streamDisplay(text: string): string {
  const cut = text.lastIndexOf('\n') + 1
  return cut === text.length || !text.includes('\r', cut) ? text : text.slice(0, cut) + foldCarriageReturns(text.slice(cut))
}

/**
 * Append stream text, merging into the last output when it is the same stream.
 * A stream this kernel writes keeps its text as ONE string (nbformat allows a
 * string or a list of lines): re-splitting the whole text into lines on every
 * chunk is what made a print loop quadratic.
 */
export function appendStream(outputs: readonly NbOutput[], name: 'stdout' | 'stderr', text: string): NbOutput[] {
  const last = outputs[outputs.length - 1]
  if (last && last.output_type === 'stream' && last.name === name) {
    return [...outputs.slice(0, -1), { ...last, text: appendStreamText(joinText(last.text), text) }]
  }
  return [...outputs, { output_type: 'stream', name, text: appendStreamText('', text) }]
}

const displayIdOf = (o: NbOutput): string | null => {
  const t = o.transient as { display_id?: unknown } | undefined
  return typeof t?.display_id === 'string' ? t.display_id : null
}

/** A display/result/error output arriving. `update` replaces by display id and is a no-op when there is none. */
export function addOutput(outputs: readonly NbOutput[], kind: 'display' | 'update' | 'result' | 'error', output: NbOutput): NbOutput[] {
  if (kind === 'update') {
    const id = displayIdOf(output)
    if (!id) return outputs.slice()
    // Jupyter's update_display_data: new data and metadata, same output in the same place.
    return outputs.map((o) => (displayIdOf(o) === id ? { ...o, data: output.data, metadata: output.metadata ?? {} } : o))
  }
  return [...outputs, output]
}

/** Every output across a notebook that carries this display id — `update_display` reaches earlier cells too. */
export function hasDisplayId(outputs: readonly NbOutput[], output: NbOutput): boolean {
  const id = displayIdOf(output)
  return !!id && outputs.some((o) => displayIdOf(o) === id)
}

/** The echo of a line typed into input(): it joins the prompt on the stdout stream, like a terminal. */
export const echoInput = (outputs: readonly NbOutput[], line: string): NbOutput[] => appendStream(outputs, 'stdout', line + '\n')
