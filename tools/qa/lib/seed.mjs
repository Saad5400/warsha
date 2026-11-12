/**
 * Seed a project through the New-project template picker.
 *
 * A first visit lands on the projects Home ("Your projects", components/Home.tsx)
 * whose "New project" opens the picker; an EMPTY open project shows the
 * welcome panel's "New from a starter" instead. Either way: pick a language →
 * pick a starter (app/src/components/TemplatePicker.tsx). Every seed in
 * the suite goes through here so there is one place to fix when the flow moves.
 *
 * Names, verbatim, as the picker renders them:
 *   lang:  'Python' | 'Java'            (the ready-language tiles)
 *   name:  'Python (empty)'             (the empty skeleton — FIRST card, so a
 *                                        nameless call picks it, not a lesson)
 *          'Python basics'              (beginner)
 *          'Python functions'           (intermediate)
 *          'Python (OOP starter)'       (advanced — two files, entry picker)
 *          'Java basics' / 'Java methods' / 'Java (OOP starter)'
 *
 * The first project is created straight from the card; once projects exist the
 * card opens a "New project from …" name prompt, which this helper accepts.
 */
export async function seedStarter(page, { lang = 'Python', name } = {}) {
  await openNewProject(page)
  const dialog = page.locator('dialog[open]')
  // `C` must not match `C#` (the tiles read "CC · clang 16" / "C#.NET 9").
  const esc = lang.replace(/[.*+?^${}()|[\]\\#]/g, '\\$&')
  await dialog.getByRole('button', { name: new RegExp('^' + esc + (lang === 'C' ? '(?!#)' : '')) }).first().click()
  const cards = dialog.locator('.template-card')
  await (name ? cards.filter({ hasText: name }) : cards.first()).first().click()
  // When projects already exist the starter becomes a NEW project, behind a
  // "New project from …" name prompt — accept its default name.
  const create = page.locator('dialog[open]').getByRole('button', { name: 'Create', exact: true })
  if (await create.waitFor({ timeout: 1500 }).then(() => true).catch(() => false)) await create.click()
  await page.waitForSelector('.cm-content', { timeout: 30000 })
}

/**
 * Open the New-project picker from wherever the app landed: the projects Home
 * (first visit / no project open — "New project") or an empty project's
 * welcome panel ("New from a starter").
 */
export async function openNewProject(page) {
  await page.waitForSelector(WELCOME_READY, { timeout: 60000 })
  const home = page.getByRole('button', { name: 'New project', exact: true })
  const welcome = page.getByRole('button', { name: /New from a starter/ })
  if (await welcome.count()) await welcome.first().click()
  else await home.first().click()
}

/** Any start surface (Home's New project, the welcome panel) or an open editor. */
export const WELCOME_READY =
  'button:has-text("New project"), button:has-text("New from a starter"), .cm-content'

/**
 * Get into the editor from wherever a load landed. `/` is always the projects
 * Home now (an editor URL reopens its project directly): continue the most
 * recent project when there is one ("Continue where you left off"), otherwise
 * seed a starter. No-op if the editor is already up.
 */
export async function openEditor(page, seed = {}) {
  await page.waitForSelector(WELCOME_READY + ', [role="region"][aria-label="Your projects"]', { timeout: 60000 })
  if (await page.locator('.cm-content, [role="tree"]').count()) return
  const cont = page.getByRole('button', { name: /Continue where you left off/ })
  const open = page.getByRole('button', { name: /^Open — / })
  if (await cont.count()) await cont.first().click()
  else if (await open.count()) await open.first().click()
  else return seedStarter(page, seed)
  await page.waitForSelector('[role="tree"], .cm-content, [aria-label="Start a project"]', { timeout: 30000 })
}
