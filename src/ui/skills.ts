// The skills of the launched AI tools (Nanda, 2026-11-11): aristoteles.yaml names the skills
// folder of each tier; a skill that is missing there is linked to this repo's own, and said.
// work start links them, and the supervisor again before each launch, because the tiers can change
// after the start (the settings on the page, or the roles that the person accepts).
import { lstatSync, mkdirSync, symlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Effect } from 'effect'
import { readSettings } from '../config/settings.ts'
import { FilesLive } from '../services/outside.ts'

const SKILLS = ['work', 'assess', 'role-fitness']
export const linkSkills = (dir: string): ReadonlyArray<string> => {
  const lines: string[] = []
  // A dir whose settings do not read has no skills folder to link into.
  const settings = Effect.runSync(
    readSettings(dir).pipe(Effect.provide(FilesLive), Effect.orElseSucceed(() => undefined)),
  )
  if (!settings) return lines
  const folders = new Set(
    Object.values(settings.tiers)
      .map((t) => t.skills)
      .filter((s) => s !== undefined),
  )
  for (const folder of folders) {
    const at = resolve(dir, folder)
    mkdirSync(at, { recursive: true })
    const linked: string[] = []
    for (const skill of SKILLS) {
      const path = join(at, skill)
      let present = false
      try {
        lstatSync(path)
        present = true
      } catch {
        // Nothing there yet: link it.
      }
      if (present) continue
      symlinkSync(resolve(import.meta.dir, '..', '..', 'skills', skill), path)
      linked.push(skill)
    }
    if (linked.length) lines.push(`linked the skills ${linked.join(', ')} into ${at}`)
  }
  return lines
}
