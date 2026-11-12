/* QA for course-shaped IntelliSense (feat/course-intellisense): type-aware
 * member completion after a dot and JetBrains-style variable-name
 * suggestions, in Java and Python, exactly as a student meets them.
 *
 * Context lines are inserted in one go (a paste); the line under test is typed
 * CHARACTER BY CHARACTER, so the popup has to open on its own (activateOnTyping)
 * — Ctrl+Space is only used where a student would reach for it. Accepting uses
 * the real keys (Enter / Tab) and the resulting line is read back from the DOM.
 *
 *   WARSHA_URL (default http://127.0.0.1:8102/), WARSHA_SHOTS, CHROME
 */
import { chromium } from 'playwright-core'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const URL_ = (process.env.WARSHA_URL ?? 'http://127.0.0.1:8102/').replace(/\/$/, '')
const SHOTS = process.env.WARSHA_SHOTS ?? fileURLToPath(new URL('./screenshots', import.meta.url))
mkdirSync(SHOTS, { recursive: true })
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome'

const errors = []
let ctx = null
let page = null
/** A fresh browser profile — so the app opens on its projects home, not the last project. */
async function freshBrowser() {
  if (ctx) await ctx.close()
  ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'warsha-course-completions-')), {
    executablePath: CHROME,
    headless: true,
    viewport: { width: 1200, height: 860 },
  })
  page = ctx.pages()[0] ?? (await ctx.newPage())
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('crash', () => errors.push('RENDERER CRASHED'))
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon/i.test(m.text())) errors.push('console: ' + m.text().slice(0, 300))
  })
}

let pass = 0
let fail = 0
const failures = []
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ' :: ' + extra : ''}`)
  if (ok) pass++
  else {
    fail++
    failures.push(label)
  }
}

/* ---------------------------------------------------------------- helpers */

const POPUP = '.cm-tooltip-autocomplete'
const shot = (name) => page.screenshot({ path: join(SHOTS, `course-${name}.png`) })

async function newProject(lang) {
  await freshBrowser()
  await page.goto(URL_ + '/?lang=en')
  const btn = page.getByRole('button', { name: 'New project', exact: true }).first()
  await btn.waitFor({ timeout: 60000 })
  await btn.click()
  await page.locator('dialog[open]').getByRole('button', { name: new RegExp('^' + lang) }).first().click()
  await page.locator('.template-card').filter({ hasText: `${lang} (empty)` }).first().click()
  await page.waitForSelector('.cm-content', { timeout: 30000 })
  await page.waitForSelector('[role="tree"]', { timeout: 20000 })
  await page.waitForTimeout(700)
}

async function newFile(name) {
  await page.locator('aside[aria-label="Files"] button[aria-label="New file"]').click()
  const f = page.locator('[role="tree"] input')
  await f.fill(name)
  await f.press('Enter')
  await page.waitForTimeout(900)
}

async function openFile(name) {
  await page.locator('[role="tree"] [role="treeitem"]').filter({ hasText: new RegExp(`^\\s*${name.replace('.', '\\.')}\\s*$`) }).first().click()
  await page.waitForTimeout(600)
}

const closePopup = async () => {
  if (await page.locator(POPUP).count()) await page.keyboard.press('Escape')
  await page.waitForTimeout(80)
}

/** Replace the whole file as a paste would: no per-key auto-indent, no popup
 *  left open. The caret ends at `|` (the marker is removed), reached with the
 *  arrow keys so nothing is inserted around it. */
async function setDoc(text) {
  const at = text.indexOf('|')
  const full = at === -1 ? text : text.slice(0, at) + text.slice(at + 1)
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(full)
  await page.waitForTimeout(120)
  await closePopup()
  const got = (await docLines()).join('\n')
  if (got.replace(/\s+$/, '') !== full.replace(/\s+$/, '')) console.log('      (warn) setDoc mismatch: ' + JSON.stringify(got.slice(0, 200)))
  if (at !== -1) {
    const pre = text.slice(0, at).split('\n')
    const lineIdx = pre.length - 1
    const col = pre[lineIdx].length
    const lineLen = full.split('\n')[lineIdx].length
    await page.keyboard.press('Control+Home')
    for (let i = 0; i < lineIdx; i++) await page.keyboard.press('ArrowDown')
    await page.keyboard.press('End')
    for (let i = 0; i < lineLen - col; i++) await page.keyboard.press('ArrowLeft')
  }
  await page.waitForTimeout(80)
  await closePopup()
}

/** Types like a student: one key at a time, then gives the popup time to come up on its own. */
async function typeSlow(s) {
  await page.keyboard.type(s, { delay: 45 })
  await page.waitForSelector(POPUP, { timeout: 1500 }).catch(() => {})
  await page.waitForTimeout(250)
}

async function ctrlSpace() {
  await page.keyboard.press('Control+Space')
  await page.waitForSelector(POPUP, { timeout: 2500 }).catch(() => {})
  await page.waitForTimeout(250)
}

/** The rendered options, in order, with their completion type (icon class). */
const options = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.cm-tooltip-autocomplete li')].map((li) => {
      const icon = li.querySelector('.cm-completionIcon')
      const type = icon ? ([...icon.classList].find((c) => c.startsWith('cm-completionIcon-')) ?? '').replace('cm-completionIcon-', '') : ''
      return {
        label: li.querySelector('.cm-completionLabel')?.textContent ?? '',
        type,
        detail: li.querySelector('.cm-completionDetail')?.textContent ?? '',
        selected: li.getAttribute('aria-selected') === 'true',
      }
    }),
  )
const labels = async () => (await options()).map((o) => o.label)
const selectedLabel = async () => (await options()).find((o) => o.selected)?.label ?? null
const popupOpen = async () => (await page.locator(POPUP).count()) > 0

/** Things that must never be offered right after a dot. */
const SILLY = new Set(['sout', 'souf', 'serr', 'psvm', 'main', 'fori', 'foreach', 'iter', 'class', 'def', 'if', 'for', 'while', 'import', 'return', 'try', 'new', 'public', 'static', 'void', 'int', 'self', 'lambda', 'with'])
const sillyAfterDot = (opts) => opts.filter((o) => SILLY.has(o.label) || o.type === 'keyword' || o.type === 'snippet' || o.label.includes(' ') || /^[A-Za-z_]+\.[A-Za-z_]/.test(o.label))
const fmt = (opts, n = 12) => JSON.stringify(opts.slice(0, n).map((o) => (o.type ? `${o.label}:${o.type}` : o.label)))

/** The text of the line the caret is on. */
const caretLine = () =>
  page.evaluate(() => {
    const sel = window.getSelection()
    let n = sel?.focusNode ?? null
    while (n && !(n instanceof HTMLElement && n.classList.contains('cm-line'))) n = n.parentNode
    return n ? n.textContent : null
  })
const docLines = () => page.evaluate(() => [...document.querySelectorAll('.cm-content .cm-line')].map((l) => l.textContent))

/** One "after the dot" scenario: popup opens by itself, has the members, has nothing silly. */
async function memberCase(name, doc, typed, want, { notWant = [], shotName = null } = {}) {
  await setDoc(doc)
  await typeSlow(typed)
  const open = await popupOpen()
  const opts = await options()
  const ls = opts.map((o) => o.label)
  check(`${name}: popup opens while typing "${typed}"`, open)
  const missing = want.filter((w) => !ls.includes(w))
  check(`${name}: offers ${want.join(', ')}`, missing.length === 0, missing.length ? `missing ${JSON.stringify(missing)} in ${fmt(opts, 30)}` : fmt(opts, 8))
  const silly = sillyAfterDot(opts)
  check(`${name}: nothing silly after the dot`, silly.length === 0, silly.length ? fmt(silly) : '')
  const bad = notWant.filter((w) => ls.includes(w))
  if (notWant.length) check(`${name}: does not offer ${notWant.join(', ')}`, bad.length === 0, bad.length ? JSON.stringify(bad) : '')
  if (shotName) await shot(shotName)
  await closePopup()
  return opts
}

/** Types `typed`, presses `key`, expects the caret line to read `expect`. */
async function acceptCase(name, doc, typed, key, expect, { wantSelected = null } = {}) {
  await setDoc(doc)
  await typeSlow(typed)
  const sel = await selectedLabel()
  if (typed.includes('.')) {
    const silly = sillyAfterDot(await options())
    check(`${name}: nothing silly after "${typed}"`, silly.length === 0, silly.length ? fmt(silly) : '')
  }
  if (wantSelected) check(`${name}: "${wantSelected}" is pre-selected`, sel === wantSelected, `selected=${sel}; ${fmt(await options(), 8)}`)
  await page.keyboard.press(key)
  await page.waitForTimeout(250)
  const line = await caretLine()
  check(`${name}: ${key} gives "${expect.trim()}"`, line?.trim() === expect.trim(), JSON.stringify(line))
  await closePopup()
  return line
}

async function hoverWord(word, nth = 0) {
  // Find the word's on-screen box in the editor and move the mouse onto it.
  const box = await page.evaluate(
    ({ word, nth }) => {
      const lines = [...document.querySelectorAll('.cm-content .cm-line')]
      let seen = 0
      for (const line of lines) {
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
        let t
        while ((t = walker.nextNode())) {
          let i = -1
          while ((i = t.textContent.indexOf(word, i + 1)) !== -1) {
            const prev = t.textContent[i - 1]
            const next = t.textContent[i + word.length]
            if ((prev && /\w/.test(prev)) || (next && /\w/.test(next))) continue
            if (seen++ < nth) continue
            const r = document.createRange()
            r.setStart(t, i)
            r.setEnd(t, i + word.length)
            const b = r.getBoundingClientRect()
            return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
          }
        }
      }
      return null
    },
    { word, nth },
  )
  if (!box) return null
  await page.mouse.move(5, 5)
  await page.waitForTimeout(150)
  await page.mouse.move(box.x, box.y)
  await page.waitForSelector('.cm-tooltip-hover', { timeout: 2500 }).catch(() => {})
  await page.waitForTimeout(200)
  const text = await page.locator('.cm-tooltip-hover').first().innerText().catch(() => null)
  return text
}

/* ================================================================== Java ================================================================== */

console.log('\n=========== JAVA ===========')
await newProject('Java')

const STUDENT = `public class Student {
    private String name;
    private double gpa;
    protected int id;

    public Student(String name, double gpa) {
        this.name = name;
        this.gpa = gpa;
    }

    /** The student's full name. */
    public String getName() { return name; }

    public double getGpa() { return gpa; }

    public void setGpa(double gpa) { this.gpa = gpa; }

    public boolean isHonors() { return gpa >= 3.5; }

    @Override
    public String toString() { return name + " (" + gpa + ")"; }
}
`
const GRAD = `public class GradStudent extends Student {
    private String thesis;

    public GradStudent(String name, double gpa, String thesis) {
        super(name, gpa);
        this.thesis = thesis;
    }

    public String getThesis() { return thesis; }
}
`
await newFile('Student.java')
await setDoc(STUDENT)
await newFile('GradStudent.java')
await setDoc(GRAD)
await openFile('Main.java')

const main = (body, imports = '') => `${imports}public class Main {
    public static void main(String[] args) {
${body}
    }
}
`

console.log('\n--- J1 arrays: .length')
await memberCase('J1 int[] local', main('        int[] nums = new int[5];\n        |'), 'nums.', ['length'], { shotName: 'java-array-length' })
await acceptCase('J1 accept length', main('        int[] nums = new int[5];\n        |'), 'nums.le', 'Enter', 'nums.length', { wantSelected: 'length' })
await memberCase('J1 String[] args param', main('        |'), 'args.', ['length'])

console.log('\n--- J2 parameters of a method')
await memberCase(
  'J2 parameter arr',
  `public class Main {
    static int sum(int[] arr, String label) {
        |
    }
}
`,
  'arr.',
  ['length'],
)
await memberCase(
  'J2 String parameter',
  `public class Main {
    static int sum(int[] arr, String label) {
        |
    }
}
`,
  'label.',
  ['length', 'charAt', 'equals'],
)

console.log('\n--- J3 catch variable')
await memberCase('J3 catch (Exception e)', main('        try {\n            int x = 1 / 0;\n        } catch (ArithmeticException e) {\n            |\n        }'), 'e.', ['getMessage', 'printStackTrace'], { shotName: 'java-catch-member' })
await acceptCase('J3 accept getMessage', main('        try {\n            int x = 1 / 0;\n        } catch (ArithmeticException e) {\n            System.out.println(|);\n        }'), 'e.getM', 'Enter', 'System.out.println(e.getMessage);')

console.log('\n--- J4 the student\'s own class, from ANOTHER file')
await memberCase(
  'J4 Student (Student.java) from Main.java',
  main('        Student s = new Student("Sara", 3.9);\n        |'),
  's.',
  ['getName', 'getGpa', 'setGpa', 'isHonors', 'toString'],
  { notWant: ['name', 'gpa'], shotName: 'java-own-class-other-file' },
)
await acceptCase('J4 accept getName', main('        Student s = new Student("Sara", 3.9);\n        String n = |'), 's.getN', 'Enter', 'String n = s.getName', { wantSelected: 'getName' })
await acceptCase('J4 accept with Tab', main('        Student s = new Student("Sara", 3.9);\n        |'), 's.isH', 'Tab', 's.isHonors')

console.log('\n--- J5 inheritance (GradStudent extends Student, separate file)')
await memberCase('J5 GradStudent', main('        GradStudent g = new GradStudent("Ali", 3.2, "AI");\n        |'), 'g.', ['getThesis', 'getName', 'getGpa', 'toString'], { shotName: 'java-inheritance' })

console.log('\n--- J6 chains through return types')
await memberCase('J6 sc.next().', main('        Scanner sc = new Scanner(System.in);\n        char c = |', 'import java.util.Scanner;\n\n'), 'sc.next().', ['charAt', 'length', 'equals'], { shotName: 'java-chain' })
await acceptCase('J6 accept charAt in chain', main('        Scanner sc = new Scanner(System.in);\n        char c = |', 'import java.util.Scanner;\n\n'), 'sc.next().cha', 'Enter', 'char c = sc.next().charAt', { wantSelected: 'charAt' })
await memberCase('J6 s.getName().', main('        Student s = new Student("Sara", 3.9);\n        |'), 's.getName().', ['charAt', 'length'])
await memberCase('J6 s.getName().toU (deeper in the list)', main('        Student s = new Student("Sara", 3.9);\n        |'), 's.getName().toU', ['toUpperCase'])
await memberCase(
  'J6 list.get(0). (generic element type)',
  main('        ArrayList<Student> list = new ArrayList<>();\n        |', 'import java.util.ArrayList;\n\n'),
  'list.get(0).',
  ['getName', 'getGpa'],
)

console.log('\n--- J7 this. inside the student\'s class')
await openFile('Student.java')
await setDoc(STUDENT.replace('public boolean isHonors() { return gpa >= 3.5; }', 'public boolean isHonors() {\n        |\n    }'))
await typeSlow('this.')
{
  const ls = await labels()
  check('J7 this. offers fields and methods', ['name', 'gpa', 'getName', 'setGpa'].every((w) => ls.includes(w)), fmt(await options(), 20))
  check('J7 this.: nothing silly', sillyAfterDot(await options()).length === 0, fmt(sillyAfterDot(await options())))
  await closePopup()
}
await setDoc(STUDENT)
await openFile('GradStudent.java')
await setDoc(GRAD.replace('public String getThesis() { return thesis; }', 'public String getThesis() {\n        |\n    }'))
await typeSlow('super.')
{
  const ls = await labels()
  check('J7 super. in GradStudent offers Student\'s methods', ['getName', 'getGpa', 'toString'].every((w) => ls.includes(w)), fmt(await options(), 20))
  check('J7 super. does not offer the subclass\'s getThesis', !ls.includes('getThesis'), fmt(await options(), 20))
  await closePopup()
}
await setDoc(GRAD)
await openFile('Main.java')

console.log('\n--- J8 everyday library receivers')
await memberCase('J8 System.out.', main('        |'), 'System.out.', ['println', 'print', 'printf'])
await memberCase('J8 string literal', main('        int n = |'), '"hello".', ['length', 'charAt'])
await memberCase('J8 sc. Scanner course methods', main('        Scanner sc = new Scanner(System.in);\n        |', 'import java.util.Scanner;\n\n'), 'sc.', ['nextInt', 'nextLine', 'nextDouble', 'nextBoolean', 'hasNextInt'])
{
  await setDoc(main('        Scanner sc = new Scanner(System.in);\n        |', 'import java.util.Scanner;\n\n'))
  await typeSlow('sc.')
  const top = (await labels()).slice(0, 6)
  const objectFirst = top.filter((l) => ['equals', 'getClass', 'hashCode', 'notify', 'wait'].includes(l))
  check('J8 sc. leads with Scanner methods, not Object\'s equals/getClass/hashCode', objectFirst.length === 0, JSON.stringify(top))
  await shot('java-scanner-top')
  await closePopup()
}

console.log('\n--- J9 variable-name suggestions')
{
  await setDoc(main('        |', 'import java.util.Scanner;\n\n'))
  await typeSlow('Scanner s')
  const opts = await options()
  check('J9 "Scanner s" (typed) suggests scanner', opts.some((o) => o.label === 'scanner'), fmt(opts))
  check('J9 "Scanner s": scanner is pre-selected', (await selectedLabel()) === 'scanner', `selected=${await selectedLabel()}`)
  check('J9 "Scanner s": no snippets/keywords (sout, switch, static…)', !opts.some((o) => o.type === 'keyword' || o.type === 'snippet' || SILLY.has(o.label)), fmt(opts))
  await shot('java-name-scanner')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(200)
  check('J9 Enter gives "Scanner scanner"', (await caretLine())?.trim() === 'Scanner scanner', JSON.stringify(await caretLine()))
  await closePopup()
}
{
  await setDoc(main('        |', 'import java.util.Scanner;\n\n'))
  await typeSlow('Scanner ')
  const autoOpened = await popupOpen()
  await closePopup()
  await ctrlSpace()
  const opts = await options()
  check('J9 "Scanner " + Ctrl+Space suggests scanner, sc, input', ['scanner', 'sc', 'input'].every((w) => opts.some((o) => o.label === w)), fmt(opts) + ` (auto-opened on the space: ${autoOpened})`)
  await closePopup()
}
{
  // The full student flow: type the type with auto-import, then the name.
  await setDoc(main('        |'))
  await typeSlow('ArrayLi')
  check('J9 "ArrayLi" offers ArrayList', (await labels()).includes('ArrayList'), fmt(await options()))
  await page.keyboard.press('Enter')
  await page.waitForTimeout(250)
  let lines = await docLines()
  check('J9 accepting ArrayList adds import java.util.ArrayList;', lines.includes('import java.util.ArrayList;'), JSON.stringify(lines.slice(0, 3)))
  check('J9 accepted ArrayList landed once', lines.filter((l) => /ArrayList/.test(l) && !/import/.test(l)).length === 1 && lines.some((l) => l.trim() === 'ArrayList'), JSON.stringify(lines))
  await typeSlow('<Student> s')
  const opts = await options()
  check('J9 "ArrayList<Student> s" suggests students first', opts[0]?.label === 'students', fmt(opts))
  await shot('java-name-students')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(200)
  check('J9 Enter gives "ArrayList<Student> students"', /^ArrayList<Student>>? students$/.test((await caretLine())?.trim() ?? ''), JSON.stringify(await caretLine()))
  check('J9 no stray ">" from auto-close', (await caretLine())?.trim() === 'ArrayList<Student> students', JSON.stringify(await caretLine()))
  await closePopup()
}
{
  await setDoc(main('        try {\n            new java.io.FileReader("x.txt");\n        } |', 'import java.io.IOException;\n\n'))
  await typeSlow('catch (IOException e')
  const opts = await options()
  check('J9 "catch (IOException e" suggests e first', opts[0]?.label === 'e', fmt(opts))
  check('J9 catch: no keyword/snippet noise', !opts.some((o) => o.type === 'keyword' || o.type === 'snippet'), fmt(opts))
  await shot('java-name-catch')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(200)
  const line = (await caretLine())?.trim()
  check('J9 catch: Enter keeps a single "e"', /catch \(IOException e\)?$/.test(line ?? ''), JSON.stringify(line))
  await closePopup()
}
{
  await setDoc(main('        Student[] all = new Student[3];\n        |'))
  await typeSlow('for (Student s')
  const opts = await options()
  check('J9 "for (Student s" (left-to-right, no collection yet) suggests student', opts.some((o) => o.label === 'student'), fmt(opts))
  await closePopup()
}
{
  // Going back to fill the loop variable after writing the collection.
  await setDoc(main('        String[] names = {"a", "b"};\n        for (String | : names) {\n        }'))
  await typeSlow('n')
  const opts = await options()
  check('J9 "for (String n| : names)" suggests name first', opts[0]?.label === 'name', fmt(opts))
  await closePopup()
}
{
  await setDoc(main('        Student s = new Student("a", 1);\n        |'))
  await typeSlow('Student s')
  const opts = await options()
  check('J9 a second Student gets a fresh name (student, not the taken s)', opts.some((o) => o.label === 'student'), fmt(opts))
  await closePopup()
}
{
  // Names must not hijack ordinary statements.
  await setDoc(main('        int total = 0;\n        |'))
  await typeSlow('return to')
  const opts = await options()
  check('J9 "return to" offers the variable total (no name suggestions)', opts.some((o) => o.label === 'total') && !opts.some((o) => o.detail === 'suggested name'), fmt(opts, 40))
  await closePopup()
  await setDoc(main('        |'))
  await typeSlow('System.out.println(x')
  check('J9 inside a call, no name suggestions', !(await options()).some((o) => o.detail === 'suggested name'), fmt(await options()))
  await closePopup()
}
{
  // Snippets still work where they belong.
  await setDoc(main('        |'))
  await typeSlow('sout')
  check('J9 sout snippet still offered at statement start', (await labels()).includes('sout'), fmt(await options()))
  await closePopup()
}

{
  // A comparison is not a declaration: `n > Ma` must offer Math / MAX_VALUE-ish words, not names.
  await setDoc(main('        int n = 5;\n        |'))
  await typeSlow('if (n < 1 || n > Ma')
  const opts = await options()
  check('J9 "if (n < 1 || n > Ma" is not a naming spot', !opts.some((o) => o.detail === 'suggested name'), fmt(opts))
  check('J9 "if (n < 1 || n > Ma" offers Math', opts.some((o) => o.label === 'Math' || o.label.startsWith('Math.')), fmt(opts))
  await shot('java-comparison-not-name')
  await closePopup()
}

console.log('\n--- J10 hover / info cards on new members')
{
  await setDoc(main('        int[] nums = new int[5];\n        Student s = new Student("Sara", 3.9);\n        System.out.println(nums.length + s.getName());'))
  await page.waitForTimeout(400)
  const h1 = await hoverWord('length')
  check('J10 hover on nums.length shows a card', !!h1 && h1.length > 0, JSON.stringify(h1?.slice(0, 120)))
  check('J10 hover on nums.length describes the ARRAY field, not String.length()', !!h1 && !/length\(\)|characters/.test(h1), JSON.stringify(h1?.slice(0, 120)))
  await shot('java-hover-length')
  const h2 = await hoverWord('getName')
  check('J10 hover on s.getName shows a card (own doc comment)', !!h2 && /name/i.test(h2), JSON.stringify(h2?.slice(0, 160)))
  await shot('java-hover-getName')
  await page.mouse.move(5, 5)
  // Completion info panel for a new member.
  await setDoc(main('        Scanner sc = new Scanner(System.in);\n        |', 'import java.util.Scanner;\n\n'))
  await typeSlow('sc.nextBo')
  await page.waitForTimeout(500)
  const info = await page.locator('.cm-completionInfo').first().innerText().catch(() => null)
  console.log('      (info) completion info panel for sc.nextBoolean: ' + JSON.stringify(info?.slice(0, 120) ?? null))
  await shot('java-info-nextBoolean')
  await closePopup()
}

/* ================================================================ Python ================================================================ */

console.log('\n=========== PYTHON ===========')
await newProject('Python')
const HELPER = `def greet(name):
    """Say hello to someone."""
    return "Hello, " + name


class Student:
    def __init__(self, name, grades):
        self.name = name
        self.grades = grades

    def average(self):
        """The mean of the grades."""
        return sum(self.grades) / len(self.grades)


class GradStudent(Student):
    def __init__(self, name, grades, thesis):
        super().__init__(name, grades)
        self.thesis = thesis

    def defend(self):
        return self.thesis
`
await newFile('helper.py')
await setDoc(HELPER)
await page.waitForTimeout(300)
const mainPy = (await page.locator('[role="tree"] [role="treeitem"]').allInnerTexts()).map((s) => s.trim()).find((s) => /\.py$/.test(s) && s !== 'helper.py')
console.log('  (entry file: ' + mainPy + ')')
await openFile(mainPy)

console.log('\n--- P1 module in another file')
await memberCase('P1 import helper; helper.', 'import helper\n\n|', 'helper.', ['greet', 'Student'], { shotName: 'python-module-helper' })
await memberCase('P1 from helper import Student; s.', 'from helper import Student\n\ns = Student("Sara", [90, 80])\n|', 's.', ['name', 'grades', 'average'], { shotName: 'python-own-class-other-file' })
await acceptCase('P1 accept average', 'from helper import Student\n\ns = Student("Sara", [90, 80])\nprint(|)', 's.av', 'Enter', 'print(s.average)', { wantSelected: 'average' })
await memberCase('P1 inherited: GradStudent', 'from helper import GradStudent\n\ng = GradStudent("Ali", [70], "AI")\n|', 'g.', ['defend', 'thesis', 'average', 'name'])
await memberCase('P1 helper.Student(...) direct', 'import helper\n\ns = helper.Student("Sara", [1])\n|', 's.', ['average', 'name'])

console.log('\n--- P2 self. and super()')
await memberCase(
  'P2 self. in a method',
  `class Account:
    def __init__(self, owner):
        self.owner = owner
        self.balance = 0

    def deposit(self, amount):
        self.balance += amount

    def show(self):
        |
`,
  'self.',
  ['owner', 'balance', 'deposit', 'show'],
  { shotName: 'python-self' },
)
await memberCase(
  'P2 super(). in a subclass',
  `class Animal:
    def __init__(self, name):
        self.name = name

    def speak(self):
        return "..."


class Dog(Animal):
    def speak(self):
        return |
`,
  'super().',
  ['speak', '__init__'],
)

console.log('\n--- P3 numpy / pandas / csv')
await memberCase('P3 np.', 'import numpy as np\n\n|', 'np.', ['array', 'arange', 'mean'], { shotName: 'python-numpy-module' })
await memberCase('P3 numpy array a.', 'import numpy as np\n\na = np.array([1, 2, 3])\n|', 'a.', ['shape', 'mean', 'reshape', 'sum'], { shotName: 'python-numpy-array' })
await memberCase('P3 pd.', 'import pandas as pd\n\n|', 'pd.', ['DataFrame', 'read_csv'])
await memberCase('P3 DataFrame df.', 'import pandas as pd\n\ndf = pd.read_csv("grades.csv")\n|', 'df.', ['head', 'describe', 'columns'], { shotName: 'python-pandas-df' })
await memberCase('P3 Series df["x"].', 'import pandas as pd\n\ndf = pd.read_csv("grades.csv")\n|', 'df["score"].', ['mean', 'max'])
await memberCase('P3 np.ze (deeper in the list)', 'import numpy as np\n\n|', 'np.ze', ['zeros'])
await memberCase('P3 csv.', 'import csv\n\n|', 'csv.', ['reader', 'writer', 'DictReader'])

console.log('\n--- P4 builtins after a dot')
await memberCase('P4 str var', 'name = "sara"\n|', 'name.', ['capitalize', 'find', 'join'])
await acceptCase('P4 accept upper via prefix', 'name = "sara"\n|', 'name.upp', 'Enter', 'name.upper', { wantSelected: 'upper' })
await memberCase('P4 list literal var', 'nums = [3, 1, 2]\n|', 'nums.', ['append', 'sort', 'pop'])
await memberCase('P4 file handle in with', 'with open("data.txt") as f:\n    |', 'f.', ['read', 'readlines', 'write'])
await memberCase('P4 exception var', 'try:\n    x = int("a")\nexcept ValueError as e:\n    |', 'e.', ['args'])

{
  // Re-assigning a variable to a method of itself must not recurse or lose its type.
  await memberCase('P4 line = line.strip() then line.', 'line = input()\nline = line.strip()\n|', 'line.', ['capitalize', 'find', 'join'], { shotName: 'python-line-strip' })
  await memberCase('P4 line = line.strip() inside a loop over a file', 'with open("data.txt") as f:\n    for line in f:\n        line = line.strip()\n        |', 'line.', ['capitalize', 'find'])
}

console.log('\n--- P5 variable-name suggestions')
{
  await setDoc('students = ["a", "b"]\n|')
  await typeSlow('for s')
  const opts = await options()
  check('P5 "for s" (left-to-right): no snippet noise', !opts.some((o) => o.type === 'snippet'), fmt(opts))
  console.log('      (info) left-to-right "for s" popup: ' + fmt(opts))
  await closePopup()
}
{
  await setDoc('students = ["a", "b"]\nfor | in students:\n    pass')
  await typeSlow('s')
  const opts = await options()
  check('P5 "for s| in students:" suggests student first', opts[0]?.label === 'student', fmt(opts))
  await shot('python-name-for')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(200)
  check('P5 Enter gives "for student in students:"', (await caretLine())?.trim() === 'for student in students:', JSON.stringify(await caretLine()))
  await closePopup()
}
{
  await setDoc('for | in range(10):\n    pass')
  await ctrlSpace()
  check('P5 "for | in range(10)" + Ctrl+Space suggests i first', (await options())[0]?.label === 'i', fmt(await options()))
  await closePopup()
}
{
  await setDoc('|')
  await typeSlow('with open("data.txt") as f')
  const opts = await options()
  check('P5 "with open(...) as f" suggests f first', opts[0]?.label === 'f', fmt(opts))
  await shot('python-name-with')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(200)
  const line = (await caretLine())?.trim()
  check('P5 with: Enter keeps a single f (no "ff", no stray paren)', line === 'with open("data.txt") as f', JSON.stringify(line))
  await closePopup()
}
{
  await setDoc('try:\n    x = int(input())\n|')
  await typeSlow('except ValueError as e')
  const opts = await options()
  check('P5 "except ValueError as e" suggests e first', opts[0]?.label === 'e', fmt(opts))
  await page.keyboard.press('Enter')
  await page.waitForTimeout(200)
  check('P5 except: Enter keeps a single e', (await caretLine())?.trim() === 'except ValueError as e', JSON.stringify(await caretLine()))
  await closePopup()
}
{
  await setDoc('|')
  await typeSlow('de')
  check('P5 def snippet still offered at statement start', (await labels()).includes('def'), fmt(await options()))
  await closePopup()
}

console.log('\n--- P6 auto-import from Python')
{
  await setDoc('|')
  await typeSlow('x = sqrt')
  await page.waitForTimeout(150)
  const opts = await options()
  const idx = opts.findIndex((o) => o.label === 'math.sqrt')
  check('P6 "sqrt" offers math.sqrt', idx !== -1, fmt(opts))
  if (idx !== -1) {
    for (let i = 0; i < idx; i++) await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(250)
    const lines = await docLines()
    check('P6 Enter on math.sqrt adds "import math" and writes math.sqrt once', lines[0] === 'import math' && lines.some((l) => l === 'x = math.sqrt'), JSON.stringify(lines))
  }
  await closePopup()
}

console.log('\n--- P7 hover / info cards on new members')
{
  await setDoc('import numpy as np\nfrom helper import Student\n\na = np.array([1, 2, 3])\nprint(a.mean())\ns = Student("Sara", [1])\nprint(s.average())\n')
  await page.waitForTimeout(400)
  const h1 = await hoverWord('mean')
  check('P7 hover on a.mean shows a card', !!h1 && h1.length > 0, JSON.stringify(h1?.slice(0, 120)))
  await shot('python-hover-mean')
  const h2 = await hoverWord('average', 0)
  check('P7 hover on s.average shows its docstring', !!h2 && /mean of the grades/i.test(h2), JSON.stringify(h2?.slice(0, 160)))
  await shot('python-hover-average')
  await page.mouse.move(5, 5)
  await setDoc('import pandas as pd\n\ndf = pd.read_csv("g.csv")\n|')
  await typeSlow('df.desc')
  await page.waitForTimeout(500)
  const info = await page.locator('.cm-completionInfo').first().innerText().catch(() => null)
  console.log('      (info) completion info panel for df.describe: ' + JSON.stringify(info?.slice(0, 120) ?? null))
  await closePopup()
}

/* ----------------------------------------------------------------- tally */
console.log('\nerrors: ' + (errors.length ? JSON.stringify(errors, null, 1) : 'none'))
check('no page errors / console errors during the whole run', errors.length === 0, errors.length ? `${errors.length} logged` : '')
console.log(`\n==== course completions: ${pass}/${pass + fail} passed ====`)
if (failures.length) console.log('failed:\n  - ' + failures.join('\n  - '))
await ctx.close()
process.exit(fail ? 1 : 0)
