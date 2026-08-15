/**
 * The tutorials registry — every lesson, in display order, plus the category
 * metadata the index groups them under. The TutorialsPage reads only this.
 *
 * Adding a lesson: write `lessons/<slug>.ts` (copy getting-started.ts), import
 * it here, and drop it into TUTORIALS in the order it should appear.
 */
import type { Text, Tutorial, TutorialCategory } from './types'

import { gettingStarted } from './lessons/getting-started'
import { createProject } from './lessons/create-project'
import { editor } from './lessons/editor'
import { files } from './lessons/files'
import { search } from './lessons/search'
import { run } from './lessons/run'
import { console as consoleLesson } from './lessons/console'
import { preview } from './lessons/preview'
import { share } from './lessons/share'
import { importProject } from './lessons/import'
import { account } from './lessons/account'
import { settings } from './lessons/settings'

/** Display order — grouped by category (the categories keep this order too). */
export const TUTORIALS: Tutorial[] = [
  gettingStarted,
  createProject,
  editor,
  files,
  search,
  run,
  consoleLesson,
  preview,
  share,
  importProject,
  account,
  settings,
]

/** The category buckets, in the order the index shows them, with a heading. */
export const CATEGORIES: { id: TutorialCategory; label: Text }[] = [
  { id: 'basics', label: { en: 'First steps', ar: 'الخطوات الأولى' } },
  { id: 'coding', label: { en: 'Writing code', ar: 'كتابة الكود' } },
  { id: 'running', label: { en: 'Running code', ar: 'تشغيل الكود' } },
  { id: 'sharing', label: { en: 'Sharing & saving', ar: 'المشاركة والحفظ' } },
  { id: 'settings', label: { en: 'Settings', ar: 'الإعدادات' } },
]

export const tutorialById = (id: string): Tutorial | undefined => TUTORIALS.find((t) => t.id === id)
