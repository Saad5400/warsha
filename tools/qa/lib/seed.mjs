/**
 * Seed a project through the New-project template picker.
 *
 * The old flow put one starter button per template straight on the welcome
 * panel ("Python starter", "Java (OOP starter)"). That did not survive twenty
 * languages, so starting a project is now: New from a starter → pick a language
 * → pick a starter (see app/src/components/TemplatePicker.tsx). Every seed in
 * the suite goes through here so there is one place to fix when the flow moves.
 *
 * Names, verbatim, as the picker renders them:
 *   lang:  'Python' | 'Java'            (the ready-language tiles)
 *   name:  'Python basics'              (beginner)
 *          'Python functions'           (intermediate)
 *          'Python (OOP starter)'       (advanced — two files, entry picker)
 *          'Java basics' / 'Java methods' / 'Java (OOP starter)'
 *
 * On an EMPTY project a starter fills it in place (no name prompt); from a
 * project that already has files it opens a "New project from …" prompt, which
 * this helper does not click through — pass through a project that is empty.
 */
export async function seedStarter(page, { lang = 'Python', name } = {}) {
  await page.getByRole('button', { name: /New from a starter/ }).click()
  const dialog = page.locator('dialog[open]')
  await dialog.getByRole('button', { name: new RegExp('^' + lang) }).click()
  const cards = dialog.locator('.template-card')
  await (name ? cards.filter({ hasText: name }) : cards.first()).first().click()
}

/** Selector for the empty project's welcome panel being on screen. */
export const WELCOME_READY = 'button:has-text("New from a starter"), .cm-content'
