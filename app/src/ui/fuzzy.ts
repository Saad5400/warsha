/**
 * The quick input's subsequence scorer (VS Code's fuzzy-match family, sized to
 * this app). A query matches a target when its characters appear in order —
 * `mnjv` finds `Main.java` — and the SCORE decides which of several matches
 * deserves the top row, which is the whole product: typing `mai` must rank
 * `Main.java` over `domain/remains.py` without the student thinking about why.
 *
 * Scoring is a small dynamic program rather than a greedy left-to-right walk,
 * because greedy commits to the first occurrence of each character and then
 * misses the alignment a human sees (`ba` in `alpha/beta` should light up
 * `beta`, not the `a` of `alpha` plus the `b` of `beta`). The bonuses are the
 * classic ones, in the proportions VS Code uses — word starts outrank runs,
 * runs outrank stray hits:
 *
 *   +1  every matched character
 *   +8  the character opens a word: index 0, after a separator (/ \ _ - . space :)
 *       or a camelCase boundary (`Main` in `openMainFile`)
 *   +4  it continues a consecutive run
 *   +1  it matches case exactly when the query char is uppercase
 *   -1…-4  the FIRST hit sits away from the target's start (capped, so a long
 *       directory prefix dims a match without drowning it)
 *
 * Matching is case-insensitive; case only ever adds. No penalty for unmatched
 * target characters — the consecutive-run bonus already makes tight matches
 * beat scattered ones, and a penalty would punish long paths for being long.
 */

export interface FuzzyMatch {
  /** Higher is better. Comparable only between targets scored with one query. */
  score: number
  /** Indices into the target of the matched characters, ascending. */
  positions: number[]
}

/** Beyond this the quadratic table stops being free; a longer target is
 *  degenerate input (no student path is 512 chars) and is truncated, not
 *  trusted. */
const MAX_TARGET = 512

/** "Unreachable" for the DP table. Compared against NEG / 2 so that a real
 *  score which happens to be slightly negative (first-hit penalty on a one-char
 *  query) is never mistaken for it. */
const NEG = -1e9

function isWordStart(target: string, targetLow: string, index: number): boolean {
  if (index === 0) return true
  const prev = target[index - 1]
  if (prev === '/' || prev === '\\' || prev === '_' || prev === '-' || prev === '.' || prev === ' ' || prev === ':')
    return true
  // camelCase: an uppercase letter after a non-uppercase one.
  const cur = target[index]
  return cur !== targetLow[index] && prev === prev.toLowerCase()
}

export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  // An empty query matches everything equally — the caller shows the unfiltered
  // list and this result carries no highlight.
  if (query.length === 0) return { score: 0, positions: [] }

  const t = target.length > MAX_TARGET ? target.slice(0, MAX_TARGET) : target
  const m = query.length
  const n = t.length
  if (m > n) return null

  const qLow = query.toLowerCase()
  const tLow = t.toLowerCase()

  // Cheap subsequence pre-check, so the quadratic table only runs on targets
  // that can match at all — which, mid-keystroke, is most of the work saved.
  {
    let i = 0
    for (let j = 0; j < n && i < m; j++) if (qLow[i] === tLow[j]) i++
    if (i < m) return null
  }

  // score[i][j]: best score matching the first i query chars within the first
  // j target chars. matched[i][j]: whether that best ends with q[i-1] taken at
  // t[j-1] — read again for the consecutive-run bonus and by the traceback.
  const width = n + 1
  const score = new Float64Array((m + 1) * width).fill(NEG)
  const matched = new Uint8Array((m + 1) * width)
  for (let j = 0; j <= n; j++) score[j] = 0

  for (let i = 1; i <= m; i++) {
    for (let j = i; j <= n; j++) {
      let best = score[i * width + j - 1] // leave t[j-1] unmatched
      let tookMatch = 0
      if (qLow[i - 1] === tLow[j - 1]) {
        const prev = score[(i - 1) * width + j - 1]
        if (prev > NEG / 2) {
          let s = prev + 1
          if (matched[(i - 1) * width + j - 1]) s += 4
          if (isWordStart(t, tLow, j - 1)) s += 8
          if (query[i - 1] === t[j - 1] && query[i - 1] !== qLow[i - 1]) s += 1
          if (i === 1) s -= Math.min(j - 1, 4)
          // >= so a tie prefers matching here — the traceback then lights the
          // character under the score it reports rather than an earlier twin.
          if (s >= best) {
            best = s
            tookMatch = 1
          }
        }
      }
      score[i * width + j] = best
      matched[i * width + j] = tookMatch
    }
  }

  const finalScore = score[m * width + n]
  if (finalScore <= NEG / 2) return null

  const positions: number[] = []
  let i = m
  let j = n
  while (i > 0 && j > 0) {
    if (matched[i * width + j]) {
      positions.push(j - 1)
      i--
    }
    j--
  }
  positions.reverse()
  return { score: finalScore, positions }
}

/** Matched positions folded into half-open [start, end) runs, which is the
 *  shape a renderer wants — one <span> per run, not one per character. */
export function toRanges(positions: number[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  for (const p of positions) {
    const last = ranges[ranges.length - 1]
    if (last && last[1] === p) last[1] = p + 1
    else ranges.push([p, p + 1])
  }
  return ranges
}
