# Warsha — Notebook cells (design spec)

The notebook surface (`app/src/components/notebook/`), specified once so it is
implemented once. Reference: Google Colab's current cell design, re-expressed in
Warsha's tokens (`tokens.css`, THEME-V5 monochrome; DENSITY for desk vs touch).
`tools/qa/notebook-check.mjs` asserts the geometry below;
`tools/qa/notebook-visuals.mjs` shoots every state.

## 1. Anatomy

```
 ┌ cell (border box, radius --r-lg) ───────────────────────────────┐
 │▌ run column │ code box (editor, radius --r-md, tinted, no border)│
 │▌  ( ▶ )     │   x = 1                                            │
 │▌   [3]      │                                                    │
 │▌  ( ⋯ )     │   output text starts at the editor's TEXT edge     │
 └─────────────────────────────────────────────────────────────────┘
   ▲ rail: inside the border box
```

- **One container.** The cell's border box is the only box with a border. The
  code box is a tinted area with no border; nothing is nested inside a second
  frame.
- **Columns.** Run column + body. Desk: run column 44px. Touch: 40px. Body
  `minmax(0,1fr)`. Cell padding 4px all round.
- **Text edge.** Everything that is text in a code cell (the code, its outputs)
  starts at one x: the editor's text edge, measured from the editor, never
  hard-coded. Rendered markdown starts at the same edge as code with line
  numbers off (desk 28px into the body, touch 10px).

## 2. States (colours are tokens)

| State | Border | Rail (2px, inset 6px top/bottom, inside the border) | Background |
| --- | --- | --- | --- |
| idle | transparent | none | none |
| hover (desk) | `--border-subtle` | none | none |
| selected (command mode) | `--border-subtle` | `--text-3` | `--surface-2` |
| editing (caret in it) | `--border-control` | `--info` | `--surface-2` |
| running | as selected/idle | — | — (the run button spins) |
| queued | as idle | — | — (dashed ring with three dots; count `[*]` on touch) |
| error | as above | — | — (count in `--danger`, traceback output) |

A state is never told by fill alone (DESIGN-SPEC): selection adds a rail and a
border; editing changes both their colour.

Code box: `--surface-3` (Colab's grey code box; the editor's own background is
transparent over it). Text cells being edited use the same box.

Keyboard focus on a cell (command mode) keeps the focus ring, drawn on the
border in `--border-control` rather than the white app ring.

## 3. Run column

- **Run button.** Circle, desk 28px / touch 32px, `--border-control` ring on
  `--surface-3`. Its centre is level with the centre of the code's FIRST line.
  The play glyph is not mirrored in RTL (a media control).
- **Execution count** `[n]`, 11px `--font-code`, `--text-3`, one column with the
  button, centred.
  - Desk: the count stands IN the button's place while the cell is idle and not
    hovered or selected; hover/selection shows the button (Colab).
  - Touch: the button always shows; the count sits centred under it.
- **Running:** a spinning ring around a stop square (click = interrupt), count
  `[*]`. **Queued:** dashed ring with three dots. **Error:** count in `--danger`.
- **Run time** lives in the run button's tooltip ("Ran in 24ms") — one place,
  not a line in the output.

## 4. Output area

- Starts at the text edge (above). Streams, results, tracebacks, tables, images
  in that one column.
- **Output toolbar:** one 24px icon button (⋯ "Output actions": Clear output,
  Hide output) in the run column, level with the output's first line; desk
  only, shown on hover of the cell or when selected. Touch: the same actions are
  in the cell's action row (⋯).
- Hidden outputs collapse to one muted "N outputs hidden" row at the text edge.

## 5. Between cells

- Gap: desk 24px (`--sp-5`), touch 8px (`--sp-2`) — the only vertical space between cells.
- **Insert affordance (desk):** a hairline across the gap, "+ Code / + Text"
  chips (22px tall) centred on it, shown on hover or keyboard focus of the gap.
  The chips fit inside the gap: they never touch a cell border.
- After the last cell the chips always show. Touch: the selected cell's action
  row carries them.

## 6. Cell toolbar

Desk: floating, top-end corner, over the cell's top border (Colab), on hover or
selection. Touch: a row under the selected cell — insert chips leading, actions
trailing.

## 7. Editor inside a cell

- Line numbers OFF by default (Colab); "Show line numbers" in the notebook's ⋯
  menu turns them on for every cell (remembered). Desk keeps the 18px
  breakpoint margin; on touch, breakpoints need line numbers on.
- The placeholder is CodeMirror's own, so it starts exactly at the caret.
- Completion popup, hover docs and lint cards are the file editor's
  (`tooltipsWithin`); no ancestor below the notebook scroller clips them.

## 8. Markdown cells

Rendered: prose at the text edge, `MD_PROSE` typography, no box. Editing: the
code box with the plain-text editor; Shift+Enter or Done renders it.

## 9. Phone

Same anatomy at touch metrics: run column 40px, button 32px with the count
under it, cell padding 4px, gaps 8px, the action row under the selected cell,
no hover states.
