import { describe, expect, test } from 'bun:test'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  codexFallbackNames,
  contentOf,
  type Entry,
  hashOf,
  inventoryOf,
  LAUNCH_OPENING,
  LAUNCH_PROJECT,
  launchOpening,
  manifestOf,
  MARKER_LINE,
  markFile,
  marked,
  preflight,
  restoreFile,
  unmarked,
} from './markers.ts'

const project = (): { dir: string; kept: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'markers-'))
  const put = (path: string, text: string) => {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  put('CLAUDE.md', '# Rules\nuse tabs\n')
  put('AGENTS.md', '# Agents\n')
  put('pkg/api/CLAUDE.md', 'nested\n')
  put('CLAUDE.local.md', 'mine\n')
  put('.claude/rules/api.md', '---\npaths: ["src/api/**"]\n---\nno globals\n')
  put('node_modules/x/CLAUDE.md', 'a package\n')
  put('.git/CLAUDE.md', 'git\n')
  put('.work/CLAUDE.md', 'work\n')
  put('README.md', 'not an instruction file\n')
  return { dir, kept: join('.work', 'onboarding', 'kept') }
}
const text = (dir: string, path: string) => readFileSync(join(dir, path), 'utf8')
const entries = (dir: string) => manifestOf(dir, inventoryOf(dir).files).entries
const entry = (dir: string, path: string): Entry => {
  const e = entries(dir).find((x) => x.path === path)
  if (e === undefined) throw new Error(`no entry ${path}`)
  return e
}

describe('the launch opening is the marker', () => {
  test('the bootstrap opening matches the words the marker names', () => {
    expect(launchOpening('host')).toBe(`${LAUNCH_OPENING} host ${LAUNCH_PROJECT}`)
    expect(MARKER_LINE).toContain(`"${LAUNCH_OPENING} <actor> ${LAUNCH_PROJECT}"`)
    expect(MARKER_LINE).not.toContain('\n')
  })
})

describe('inventoryOf', () => {
  test('instruction files at any depth and Claude rules; not .git, packages or .work', () => {
    const { dir } = project()
    expect(inventoryOf(dir).files).toEqual([
      '.claude/rules/api.md',
      'AGENTS.md',
      'CLAUDE.local.md',
      'CLAUDE.md',
      'pkg/api/CLAUDE.md',
    ])
  })
  test('links, imports and Codex fallback names; links and imports are reported, not edited', () => {
    const { dir } = project()
    const other = mkdtempSync(join(tmpdir(), 'markers-other-'))
    writeFileSync(join(other, 'shared.md'), 'shared\n')
    symlinkSync(join(other, 'shared.md'), join(dir, '.claude', 'rules', 'shared.md'))
    writeFileSync(join(dir, 'CLAUDE.md'), 'see @docs/style.md and mail a@b.c\n')
    writeFileSync(join(dir, 'TEAM.md'), 'team\n')
    const inv = inventoryOf(dir, ['TEAM.md'])
    expect(inv.files).toContain('TEAM.md')
    expect(inv.files).not.toContain('.claude/rules/shared.md')
    expect(inv.reported).toContain('.claude/rules/shared.md (a link: loaded, not edited)')
    expect(inv.reported).toContain('docs/style.md (imported by CLAUDE.md)')
    expect(inv.reported.some((r) => r.startsWith('b.c'))).toBe(false)
  })
  test('Codex fallback names come from its config', () => {
    const home = mkdtempSync(join(tmpdir(), 'markers-home-'))
    mkdirSync(join(home, '.codex'))
    writeFileSync(
      join(home, '.codex', 'config.toml'),
      'model = "x"\nproject_doc_fallback_filenames = ["TEAM.md", ".agents.md"]\n',
    )
    const at = join(home, '.codex')
    const configured = codexFallbackNames(home, at)
    expect(configured.names.map(String)).toEqual(['TEAM.md', '.agents.md'])
    expect(configured.unresolved).toBeNull()
    const none = mkdtempSync(join(tmpdir(), 'markers-none-'))
    expect(codexFallbackNames(none, join(none, '.codex'))).toEqual({ names: [], unresolved: null })
    writeFileSync(join(at, 'config.toml'), "project_doc_fallback_filenames = ['TEAM.md']\n")
    expect(codexFallbackNames(home, at).unresolved).toContain('not fully read')
    writeFileSync(join(at, 'config.toml'), 'project_doc_fallback_filenames = [\n  "A.md",\n]\n')
    expect(codexFallbackNames(home, at).unresolved).toContain('not fully read')
  })
  test('a folder it cannot read makes the walk incomplete, and preflight says so', () => {
    const { dir } = project()
    const m = entries(dir)
    mkdirSync(join(dir, 'locked'))
    chmodSync(join(dir, 'locked'), 0o000)
    try {
      const inv = inventoryOf(dir)
      expect(inv.incomplete.length).toBe(1)
      chmodSync(join(dir, 'CLAUDE.md'), 0o000)
      expect(manifestOf(dir, ['CLAUDE.md']).unread[0]).toStartWith('CLAUDE.md:')
      expect(inventoryOf(dir).incomplete.some((x) => x.startsWith('CLAUDE.md:'))).toBe(true)
      chmodSync(join(dir, 'CLAUDE.md'), 0o644)
      expect(preflight(dir, m, inv)[0]).toStartWith('not read: locked')
    } finally {
      chmodSync(join(dir, 'locked'), 0o755)
    }
  })
})

describe('the line and the content', () => {
  test('first, or after a front matter block; unmarked undoes it exactly', () => {
    expect(marked('a\n')).toBe(`${MARKER_LINE}\na\n`)
    const rule = '---\npaths: ["x"]\n---\nbody\n'
    expect(marked(rule)).toBe(`---\npaths: ["x"]\n---\n${MARKER_LINE}\nbody\n`)
    expect(unmarked(marked(rule))).toBe(rule)
    expect(unmarked(rule)).toBeNull()
  })
  test('approved, marked over it, or other; a pre-marked revision is marked as it is', () => {
    const e = { path: 'a', hash: hashOf('a\n'), premarked: false }
    expect(contentOf('a\n', e)).toBe('Approved')
    expect(contentOf(marked('a\n'), e)).toBe('Marked')
    expect(contentOf('b\n', e)).toBe('Other')
    const pre = { path: 'a', hash: hashOf(marked('a\n')), premarked: true }
    expect(contentOf(marked('a\n'), pre)).toBe('Marked')
    expect(contentOf('a\n', pre)).toBe('Other')
  })
})

describe('markFile and restoreFile', () => {
  test('marks once from the kept original, keeping the mode; a second run is done', () => {
    const { dir, kept } = project()
    chmodSync(join(dir, 'CLAUDE.md'), 0o600)
    const e = entry(dir, 'CLAUDE.md')
    expect(markFile(dir, kept, e)._tag).toBe('Written')
    expect(text(dir, 'CLAUDE.md')).toBe(`${MARKER_LINE}\n# Rules\nuse tabs\n`)
    expect(statSync(join(dir, 'CLAUDE.md')).mode & 0o777).toBe(0o600)
    expect(readFileSync(join(dir, kept, e.hash), 'utf8')).toBe('# Rules\nuse tabs\n')
    expect(markFile(dir, kept, e)._tag).toBe('Done')
    expect(readdirSync(dir).some((n) => n.includes('aristoteles-'))).toBe(false)
  })
  test('a rule keeps its front matter first', () => {
    const { dir, kept } = project()
    markFile(dir, kept, entry(dir, '.claude/rules/api.md'))
    expect(text(dir, '.claude/rules/api.md')).toStartWith('---\npaths: ["src/api/**"]\n---\n')
  })
  test('a file the person changed after approving it is never written', () => {
    const { dir, kept } = project()
    const e = entry(dir, 'AGENTS.md')
    writeFileSync(join(dir, 'AGENTS.md'), '# Agents, edited\n')
    expect(markFile(dir, kept, e)._tag).toBe('Changed')
    expect(text(dir, 'AGENTS.md')).toBe('# Agents, edited\n')
  })
  test('an edit saved while the marked copy is staged is kept, in mark and in restore', () => {
    const { dir, kept } = project()
    const e = entry(dir, 'AGENTS.md')
    const edit = () => writeFileSync(join(dir, 'AGENTS.md'), 'saved meanwhile\n')
    expect(markFile(dir, kept, e, edit)._tag).toBe('Changed')
    expect(text(dir, 'AGENTS.md')).toBe('saved meanwhile\n')
    const f = entry(dir, 'CLAUDE.md')
    markFile(dir, kept, f)
    const edit2 = () => writeFileSync(join(dir, 'CLAUDE.md'), 'edited at the boundary\n')
    expect(restoreFile(dir, kept, f, edit2)._tag).toBe('Changed')
    expect(text(dir, 'CLAUDE.md')).toBe('edited at the boundary\n')
    expect(readdirSync(dir).some((n) => n.includes('aristoteles-'))).toBe(false)
  })
  test('roll back: a marked file gets its original; an edited one stays the person\'s', () => {
    const { dir, kept } = project()
    const m = entries(dir)
    for (const e of m) markFile(dir, kept, e)
    writeFileSync(join(dir, 'AGENTS.md'), 'the person edited after the marker\n')
    const out = Object.fromEntries(m.map((e) => [e.path, restoreFile(dir, kept, e)._tag]))
    expect(out).toEqual({
      '.claude/rules/api.md': 'Written',
      'AGENTS.md': 'Changed',
      'CLAUDE.local.md': 'Written',
      'CLAUDE.md': 'Written',
      'pkg/api/CLAUDE.md': 'Written',
    })
    expect(text(dir, 'CLAUDE.md')).toBe('# Rules\nuse tabs\n')
    expect(text(dir, '.claude/rules/api.md')).toBe('---\npaths: ["src/api/**"]\n---\nno globals\n')
    expect(restoreFile(dir, kept, entry(dir, 'CLAUDE.md'))._tag).toBe('Done')
  })
  test('a file marked before the approval keeps its line through a roll back', () => {
    const { dir, kept } = project()
    writeFileSync(join(dir, 'AGENTS.md'), marked('# Agents\n'))
    const e = entry(dir, 'AGENTS.md')
    expect(e.premarked).toBe(true)
    expect(markFile(dir, kept, e)._tag).toBe('Done')
    expect(restoreFile(dir, kept, e)._tag).toBe('Done')
    expect(text(dir, 'AGENTS.md')).toBe(marked('# Agents\n'))
  })
  test('no kept original: nothing is stripped by guess', () => {
    const { dir, kept } = project()
    const e = entry(dir, 'CLAUDE.md')
    markFile(dir, kept, e)
    rmSync(join(dir, kept, e.hash))
    expect(restoreFile(dir, kept, e)._tag).toBe('NoOriginal')
    expect(text(dir, 'CLAUDE.md')).toStartWith(MARKER_LINE)
  })
  test('a crash after the write and before any note: the resume finds the file done', () => {
    const { dir, kept } = project()
    const m = entries(dir)
    markFile(dir, kept, m[0]!)
    expect(m.map((e) => markFile(dir, kept, e)._tag)).toEqual([
      'Done',
      'Written',
      'Written',
      'Written',
      'Written',
    ])
  })
})

describe('paths', () => {
  test('a folder replaced by a link after approval is refused, outside untouched', () => {
    const { dir, kept } = project()
    const e = entry(dir, 'pkg/api/CLAUDE.md')
    const other = mkdtempSync(join(tmpdir(), 'markers-out-'))
    mkdirSync(join(other, 'api'))
    writeFileSync(join(other, 'api', 'CLAUDE.md'), 'nested\n')
    rmSync(join(dir, 'pkg'), { recursive: true })
    symlinkSync(other, join(dir, 'pkg'))
    expect(markFile(dir, kept, e)).toEqual({ _tag: 'Unsafe', why: 'pkg is a link' })
    expect(readFileSync(join(other, 'api', 'CLAUDE.md'), 'utf8')).toBe('nested\n')
    expect(preflight(dir, [e], { files: [], reported: [], incomplete: [] })).toEqual([
      'pkg/api/CLAUDE.md: pkg is a link',
    ])
  })
  test('a path out of the project, an absolute one, an odd one or a bad hash is refused', () => {
    const { dir, kept } = project()
    const h = hashOf('x')
    for (const [path, hash] of [
      ['../CLAUDE.md', h],
      ['/etc/CLAUDE.md', h],
      ['pkg//CLAUDE.md', h],
      ['CLAUDE.md', 'abc'],
    ] as const) {
      expect(markFile(dir, kept, { path, hash, premarked: false })._tag).toBe('Unsafe')
    }
  })
})

describe('publication races', () => {
  test('a folder on the path swapped for a link at the last moment: nothing published', () => {
    const { dir, kept } = project()
    const e = entry(dir, 'pkg/api/CLAUDE.md')
    const out = mkdtempSync(join(tmpdir(), 'markers-moved-'))
    const swap = () => {
      renameSync(join(dir, 'pkg'), join(out, 'pkg'))
      symlinkSync(join(out, 'pkg'), join(dir, 'pkg'))
    }
    const r = markFile(dir, kept, e, swap)
    expect(r._tag).toBe('Unsafe')
    expect(readFileSync(join(out, 'pkg', 'api', 'CLAUDE.md'), 'utf8')).toBe('nested\n')
    expect(readdirSync(join(out, 'pkg', 'api'))).toEqual(['CLAUDE.md'])
  })
  test('a folder replaced by another real folder at the last moment: nothing published', () => {
    const { dir, kept } = project()
    const e = entry(dir, 'pkg/api/CLAUDE.md')
    const swap = () => {
      renameSync(join(dir, 'pkg'), join(dir, 'pkg-old'))
      mkdirSync(join(dir, 'pkg', 'api'), { recursive: true })
      writeFileSync(join(dir, 'pkg', 'api', 'CLAUDE.md'), 'nested\n')
    }
    const r = markFile(dir, kept, e, swap)
    expect(r._tag === 'Unsafe' && r.why.startsWith('a folder on the path was replaced')).toBe(true)
    expect(readFileSync(join(dir, 'pkg-old', 'api', 'CLAUDE.md'), 'utf8')).toBe('nested\n')
    expect(readFileSync(join(dir, 'pkg', 'api', 'CLAUDE.md'), 'utf8')).toBe('nested\n')
  })
  test('a leaf that became a folder or a FIFO is refused, not read', () => {
    const { dir, kept } = project()
    const e = entry(dir, 'AGENTS.md')
    rmSync(join(dir, 'AGENTS.md'))
    mkdirSync(join(dir, 'AGENTS.md'))
    expect(markFile(dir, kept, e)).toEqual({ _tag: 'Unsafe', why: 'AGENTS.md is not a regular file' })
    rmSync(join(dir, 'AGENTS.md'), { recursive: true })
    Bun.spawnSync(['mkfifo', join(dir, 'AGENTS.md')])
    expect(markFile(dir, kept, e)._tag).toBe('Unsafe')
  })
  test('a CRLF rule keeps its front matter first and its bytes', () => {
    const rule = '---\r\npaths: ["x"]\r\n---\r\nbody\r\n'
    expect(marked(rule)).toBe(`---\r\npaths: ["x"]\r\n---\r\n${MARKER_LINE}\r\nbody\r\n`)
    expect(unmarked(marked(rule))).toBe(rule)
  })
  test('the mode is the file\'s whatever the umask', () => {
    const { dir, kept } = project()
    chmodSync(join(dir, 'CLAUDE.md'), 0o644)
    const old = process.umask(0o077)
    try {
      markFile(dir, kept, entry(dir, 'CLAUDE.md'))
    } finally {
      process.umask(old)
    }
    expect(statSync(join(dir, 'CLAUDE.md')).mode & 0o777).toBe(0o644)
  })
  test('a .claude/rules folder that is a link, and an ancestor\'s .claude, are reported', () => {
    const { dir } = project()
    const parent = mkdtempSync(join(tmpdir(), 'markers-up-'))
    const inner = join(parent, 'proj')
    mkdirSync(join(parent, '.claude'), { recursive: true })
    writeFileSync(join(parent, '.claude', 'CLAUDE.md'), 'above\n')
    mkdirSync(join(inner, '.claude'), { recursive: true })
    symlinkSync(join(dir, '.claude', 'rules'), join(inner, '.claude', 'rules'))
    const inv = inventoryOf(inner)
    expect(inv.reported).toContain(`${join('.claude', 'rules')} (a link: loaded, not edited)`)
    expect(inv.reported).toContain(`${join(parent, '.claude', 'CLAUDE.md')} (above the project)`)
  })
})

describe('private originals', () => {
  test('a link or a folder where an original is kept: refused, nothing outside written', () => {
    const { dir, kept } = project()
    const e = entry(dir, 'CLAUDE.md')
    const out = join(mkdtempSync(join(tmpdir(), 'markers-victim-')), 'victim')
    writeFileSync(out, 'not yours\n')
    mkdirSync(join(dir, kept), { recursive: true })
    symlinkSync(out, join(dir, kept, e.hash))
    expect(markFile(dir, kept, e)._tag).toBe('Unsafe')
    expect(readFileSync(out, 'utf8')).toBe('not yours\n')
    expect(text(dir, 'CLAUDE.md')).toBe('# Rules\nuse tabs\n')
    rmSync(join(dir, kept, e.hash))
    mkdirSync(join(dir, kept, e.hash))
    expect(markFile(dir, kept, e)._tag).toBe('Unsafe')
  })
  test('the kept folder as a link is refused, in mark and in restore', () => {
    const { dir, kept } = project()
    const e = entry(dir, 'CLAUDE.md')
    markFile(dir, kept, e)
    const moved = mkdtempSync(join(tmpdir(), 'markers-kept-'))
    rmSync(join(dir, kept), { recursive: true })
    symlinkSync(moved, join(dir, kept))
    expect(restoreFile(dir, kept, e)._tag).toBe('Unsafe')
    expect(markFile(dir, kept, entry(dir, 'AGENTS.md'))._tag).toBe('Unsafe')
  })
  test('a kept original of other bytes is never used', () => {
    const { dir, kept } = project()
    const e = entry(dir, 'CLAUDE.md')
    markFile(dir, kept, e)
    writeFileSync(join(dir, kept, e.hash), 'something else\n')
    expect(restoreFile(dir, kept, e)._tag).toBe('Unsafe')
    expect(text(dir, 'CLAUDE.md')).toStartWith(MARKER_LINE)
  })
  test('originals are private: the folder 0700, each file 0600', () => {
    const { dir, kept } = project()
    chmodSync(join(dir, 'CLAUDE.local.md'), 0o600)
    const e = entry(dir, 'CLAUDE.local.md')
    markFile(dir, kept, e)
    expect(statSync(join(dir, kept)).mode & 0o777).toBe(0o700)
    expect(statSync(join(dir, kept, e.hash)).mode & 0o777).toBe(0o600)
  })
  test('a mode changed at the last moment is the person\'s change: not written', () => {
    const { dir, kept } = project()
    chmodSync(join(dir, 'CLAUDE.md'), 0o600)
    const e = entry(dir, 'CLAUDE.md')
    const r = markFile(dir, kept, e, () => chmodSync(join(dir, 'CLAUDE.md'), 0o400))
    expect(r._tag).toBe('Changed')
    expect(statSync(join(dir, 'CLAUDE.md')).mode & 0o777).toBe(0o400)
    expect(text(dir, 'CLAUDE.md')).toBe('# Rules\nuse tabs\n')
  })
})

describe('original storage recovery', () => {
  test('a link above the kept folder: refused before any folder is made, nothing outside', () => {
    const { dir, kept } = project()
    const out = mkdtempSync(join(tmpdir(), 'markers-work-'))
    rmSync(join(dir, '.work'), { recursive: true })
    symlinkSync(out, join(dir, '.work'))
    const e = entry(dir, 'CLAUDE.md')
    expect(markFile(dir, kept, e)).toEqual({ _tag: 'Unsafe', why: '.work is not a plain folder' })
    expect(readdirSync(out)).toEqual([])
    expect(restoreFile(dir, kept, e)._tag).toBe('Done')
    expect(markFile(dir, '../elsewhere', e)._tag).toBe('Unsafe')
    const rootMode = statSync(dir).mode & 0o777
    for (const bad of ['.', './k', 'k/.', 'a//b']) expect(markFile(dir, bad, e)._tag).toBe('Unsafe')
    expect(statSync(dir).mode & 0o777).toBe(rootMode)
    expect(readdirSync(dir).some((n) => /^[0-9a-f]{64}$/.test(n))).toBe(false)
  })
  test('a crash while an original was staged: the staging file is ignored, the next run keeps it', () => {
    const { dir, kept } = project()
    const e = entry(dir, 'CLAUDE.md')
    mkdirSync(join(dir, kept), { recursive: true })
    writeFileSync(join(dir, kept, '.staging-left'), '# Rul')
    expect(markFile(dir, kept, e)._tag).toBe('Written')
    expect(readFileSync(join(dir, kept, e.hash), 'utf8')).toBe('# Rules\nuse tabs\n')
    expect(readdirSync(join(dir, kept)).filter((n) => n.startsWith('.staging-'))).toEqual([
      '.staging-left',
    ])
    expect(restoreFile(dir, kept, e)._tag).toBe('Written')
  })
})

describe('preflight', () => {
  test('clean when every file is approved or marked over it', () => {
    const { dir, kept } = project()
    const m = entries(dir)
    expect(preflight(dir, m)).toEqual([])
    markFile(dir, kept, m[0]!)
    expect(preflight(dir, m)).toEqual([])
  })
  test('a changed, a missing and a new instruction file are each named', () => {
    const { dir } = project()
    const m = entries(dir)
    writeFileSync(join(dir, 'CLAUDE.md'), 'changed\n')
    writeFileSync(join(dir, 'pkg', 'AGENTS.md'), 'new\n')
    const gone = [...m, { path: 'docs/CLAUDE.md', hash: hashOf('x'), premarked: false }]
    expect(preflight(dir, gone)).toEqual([
      'CLAUDE.md: changed since it was approved',
      'docs/CLAUDE.md: missing since it was approved',
      'pkg/AGENTS.md: new since the approval',
    ])
  })
})
