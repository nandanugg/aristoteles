import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { Schema } from 'effect'
import { FilePath } from '../../core/schema/project.ts'
import { excludeFromGit } from '../live/git-exclude.ts'

export const linkProjectSkills = (directory: string): void => {
  const file = join(directory, 'aristoteles.yaml')
  if (!existsSync(file)) return
  const settings = Schema.Struct({
    models: Schema.optionalKey(Schema.Record(Schema.String, Schema.Struct({ skills: Schema.optionalKey(FilePath) }))),
  })
  const parsed = Schema.decodeUnknownSync(settings)(Bun.YAML.parse(readFileSync(file, 'utf8')))
  for (const folder of new Set(Object.values(parsed.models ?? {}).flatMap(({ skills }) => skills ? [skills] : []))) {
    const at = join(directory, folder)
    mkdirSync(at, { recursive: true })
    const ours = []
    for (const skill of ['work', 'assess', 'role-fitness']) {
      const path = join(at, skill)
      const target = resolve(import.meta.dir, '..', '..', 'skills', skill)
      try { lstatSync(path) } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') symlinkSync(target, path)
        else throw error
      }
      if (lstatSync(path).isSymbolicLink() && readlinkSync(path) === target) ours.push(relative(directory, path))
    }
    excludeFromGit(directory, ours)
  }
}
