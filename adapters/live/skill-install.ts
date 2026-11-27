// Link the project skill into the local Claude and agents folders.
import { lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { excludeFromGit } from './git-exclude.ts'

// The code root, as the bundle sees it too: bin/work.js writes each source file's own folder in
// place of import.meta.dir, so the link never points into .cache/.
const ROOT = resolve(import.meta.dir, '..', '..')
export const SKILL_FILE = join(ROOT, 'skills', 'aristoteles', 'SKILL.md')
const SKILL_FOLDER = join(ROOT, 'skills', 'aristoteles')
const FOLDERS = ['.claude/skills', '.agents/skills']

// What is at a path, without following a link: nothing, a link (to where), a folder, or a file.
type At =
  | { readonly _tag: 'None' }
  | { readonly _tag: 'Link'; readonly to: string }
  | { readonly _tag: 'Folder' }
  | { readonly _tag: 'File' }
const at = (path: string): At => {
  try {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) return { _tag: 'Link', to: readlinkSync(path) }
    return stat.isDirectory() ? { _tag: 'Folder' } : { _tag: 'File' }
  } catch {
    return { _tag: 'None' }
  }
}
const isLinkTo = (place: At, target: string): boolean => place._tag === 'Link' && place.to === target

// The lines that say what changed; a second run says that nothing did.
export const installSkill = (dir: string): ReadonlyArray<string> => {
  const linked: Array<string> = []
  const ours: Array<string> = []
  const kept: Array<string> = []
  for (const folder of FOLDERS) {
    const skill = join(folder, 'aristoteles')
    const file = join(skill, 'SKILL.md')
    // An old link of the whole folder (work start linked folders before): a write of SKILL.md
    // through it would land in this code's own skill folder, so the link goes first.
    if (isLinkTo(at(join(dir, skill)), SKILL_FOLDER)) unlinkSync(join(dir, skill))
    const folderAt = at(join(dir, skill))
    if (folderAt._tag === 'Link' || folderAt._tag === 'File') {
      kept.push(`${skill} (the project's own)`)
      continue
    }
    const fileAt = at(join(dir, file))
    if (isLinkTo(fileAt, SKILL_FILE)) {
      ours.push(file)
      continue
    }
    if (fileAt._tag !== 'None') {
      kept.push(`${file} (the project's own)`)
      continue
    }
    mkdirSync(join(dir, skill), { recursive: true })
    symlinkSync(SKILL_FILE, join(dir, file))
    linked.push(file)
    ours.push(file)
  }
  const excluded = excludeFromGit(dir, ours)
  const lines = [
    ...(linked.length ? [`linked the /aristoteles skill: ${linked.join(', ')} -> ${SKILL_FILE}`] : []),
    ...(excluded.length ? [`git of the dir excludes ${excluded.join(', ')}`] : []),
    ...kept.map((k) => `kept ${k}; the install does not change it`),
  ]
  return lines.length ? lines : ['the /aristoteles skill is linked already; nothing changed.']
}
