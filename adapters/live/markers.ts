// The marker line (onboarding v2: ONBOARDING-V2 section 7 O5, section 8 OV2-6, sections 10-12).
// The project's own instruction files stay, a fallback for working without aristoteles, with one
// line at the top that sends aristoteles sessions away from them. The marker is the aristoteles
// launch itself: every session the harness starts fresh (the host's bootstrap launch, a
// persistent role) and every maker a role starts gets a first prompt that begins with the launch
// opening, and the line names it. (`work run continue` keeps a host's existing context: it is
// not such a launch; pass 6 relaunches the host fresh at activation.)
// activation.qnt is the model of how these writes take part in activation: a file is DONE when it
// equals its approved revision plus the line (the file decides, not a note), a file the person
// changed after approving it is never written, and a roll back restores the kept original.
// Assumption (stated for pass 6): no other writer renames over an instruction file in the instant
// between the last check and the publishing rename; an edit before that check is seen and kept.
// Bytes are handled as latin1 strings, which keep every byte as it is (the line is ASCII).
import { Schema } from 'effect'
import { Rationale, type Of } from '../../core/schema/project.ts'
import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  existsSync,
  fchmodSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'

// The host bootstrap starts with the phrase recognized by the marker.
export const LAUNCH_OPENING = 'You are'
export const LAUNCH_PROJECT = 'of an Aristoteles project.'
export const launchOpening = (actor: string): string => `${LAUNCH_OPENING} ${actor} ${LAUNCH_PROJECT}`

export const MARKER_LINE =
  `> Aristoteles: if your first prompt begins "${LAUNCH_OPENING} <actor> ${LAUNCH_PROJECT}", ` +
  'ignore this file: Aristoteles gives you your instructions. <!-- aristoteles-marker -->'

// The instruction files the supported CLIs load by name, at any depth (Claude Code: CLAUDE.md,
// CLAUDE.local.md, .claude/CLAUDE.md; Codex: AGENTS.md, AGENTS.override.md and the fallback names
// of its config), and every .md file under a .claude/rules folder (Claude Code's rules).
export const INSTRUCTION_NAMES: ReadonlyArray<string> = [
  'CLAUDE.md',
  'CLAUDE.local.md',
  'AGENTS.md',
  'AGENTS.override.md',
]
const SKIPPED_FOLDERS: ReadonlySet<string> = new Set(['.git', 'node_modules', '.work'])
const RULES = `${sep}.claude${sep}rules${sep}`
const isRule = (rel: string): boolean => rel.endsWith('.md') && `${sep}${rel}`.includes(RULES)

// Codex's configured fallback names (project_doc_fallback_filenames in config.toml under
// CODEX_HOME, else ~/.codex). A form this reader does not parse (or profiles that may set it) is
// reported in the approved file inventory.
const FallbackName = Schema.String.check(Schema.isMinLength(1)).pipe(Schema.brand('FallbackName'))
type Fallbacks = { readonly names: readonly Of<typeof FallbackName>[]; readonly unresolved: Of<typeof Rationale> | null }
export const codexFallbackNames = (
  home: string = homedir(),
  codexHome: string = process.env.CODEX_HOME ?? join(home, '.codex'),
): Fallbacks => {
  const file = join(codexHome, 'config.toml')
  if (!existsSync(file)) return { names: [], unresolved: null }
  const text = readFileSync(file, 'utf8')
  const m = /^\s*project_doc_fallback_filenames\s*=\s*\[([^\]\n]*)\]\s*$/m.exec(text)
  const named = /project_doc_fallback_filenames/.test(text)
  const quoted = m?.[1] === undefined ? [] : [...m[1].matchAll(/"([^"\\]+)"/g)].map((x) => FallbackName.make(x[1]!))
  const items = m?.[1] === undefined ? [] : m[1].split(',').map((x) => x.trim()).filter((x) => x)
  if (named && (m === null || quoted.length !== items.length || /^\s*\[profiles/m.test(text))) {
    return { names: quoted, unresolved: Rationale.make(`${file}: project_doc_fallback_filenames not fully read`) }
  }
  return { names: quoted, unresolved: null }
}

const bytesOf = (path: string): string => readFileSync(path).toString('latin1')
export const hashOf = (text: string): string =>
  createHash('sha256').update(Buffer.from(text, 'latin1')).digest('hex')

// ---- the pure part: where the line goes and what a file's text is
// The line goes first, or right after a front matter block (a rule's scope stays its first
// lines), ending as the file's lines end (LF or CRLF).
const eolOf = (text: string): string => (/^[^\n]*\r\n/.test(text) ? '\r\n' : '\n')
const frontMatterEnd = (text: string): number => {
  const eol = eolOf(text)
  if (!text.startsWith(`---${eol}`)) return 0
  const close = `${eol}---${eol}`
  const end = text.indexOf(close, 3)
  return end < 0 ? 0 : end + close.length
}
export const marked = (original: string): string => {
  const at = frontMatterEnd(original)
  return `${original.slice(0, at)}${MARKER_LINE}${eolOf(original)}${original.slice(at)}`
}
// The text without the line, or null when it carries none.
export const unmarked = (text: string): string | null => {
  const eol = eolOf(text)
  const at = frontMatterEnd(text)
  const line = `${MARKER_LINE}${eol}`
  return text.startsWith(line, at) ? text.slice(0, at) + text.slice(at + line.length) : null
}

// An approved revision: its path (relative, inside the dir), the hash of its bytes, and whether
// it already carried the line when it was approved (then it is never stripped).
export type Entry = { readonly path: string; readonly hash: string; readonly premarked: boolean }
export type Content = 'Approved' | 'Marked' | 'Other'
export const contentOf = (text: string, entry: Entry): Content => {
  if (hashOf(text) === entry.hash) return entry.premarked ? 'Marked' : 'Approved'
  const bare = unmarked(text)
  if (!entry.premarked && bare !== null && hashOf(bare) === entry.hash) return 'Marked'
  return 'Other'
}

// ---- the paths: an entry names a plain file inside the dir, reached through no link
export const safeEntry = (dir: string, entry: Entry): string | null => {
  const p = entry.path
  if (!/^[0-9a-f]{64}$/.test(entry.hash)) return 'not a sha256 hash'
  if (p === '' || isAbsolute(p) || p.includes('\0') || normalize(p) !== p) {
    return 'not a plain relative path'
  }
  if (p.split(sep).includes('..')) return 'outside the project'
  return pathProblem(dir, p)
}
// Every parent a plain folder and the leaf a regular file, none a link. A missing part is not a
// problem here (the file is missing: the caller says so); any other failure is.
const pathProblem = (dir: string, p: string): string | null => {
  const parts = p.split(sep)
  let at = dir
  for (const [i, part] of parts.entries()) {
    at = join(at, part)
    let st
    try {
      st = lstatSync(at)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      return `${relative(dir, at)}: ${(e as Error).message}`
    }
    if (st.isSymbolicLink()) return `${relative(dir, at)} is a link`
    const last = i === parts.length - 1
    if (last && !st.isFile()) return `${relative(dir, at)} is not a regular file`
    if (!last && !st.isDirectory()) return `${relative(dir, at)} is not a folder`
  }
  return null
}
// The identity of the folders on the path (device and inode), to see one replaced meanwhile.
const folderIds = (dir: string, p: string): string => {
  const parts = p.split(sep).slice(0, -1)
  let at = dir
  const ids = [lstatSync(dir)]
  for (const part of parts) {
    at = join(at, part)
    ids.push(lstatSync(at))
  }
  return ids.map((st) => `${st.dev}:${st.ino}`).join('/')
}

// ---- discovery
export type Inventory = {
  readonly files: ReadonlyArray<string> // in the project: approved, marked, restored
  readonly reported: ReadonlyArray<string> // loaded too, never edited: links, ancestors, imports
  readonly incomplete: ReadonlyArray<string> // folders the walk could not read
}
export const inventoryOf = (dir: string, names: ReadonlyArray<string> = []): Inventory => {
  const wanted = new Set([...INSTRUCTION_NAMES, ...names])
  const files: Array<string> = []
  const reported: Array<string> = []
  const incomplete: Array<string> = []
  const walk = (at: string): void => {
    let entries
    try {
      entries = readdirSync(at, { withFileTypes: true })
    } catch (e) {
      incomplete.push(`${relative(dir, at) || '.'}: ${(e as Error).message}`)
      return
    }
    for (const entry of entries) {
      const full = join(at, entry.name)
      const rel = relative(dir, full)
      if (entry.isDirectory()) {
        if (!SKIPPED_FOLDERS.has(entry.name)) walk(full)
      } else if (entry.isSymbolicLink()) {
        const inRules = `${sep}${rel}${sep}`.includes(RULES)
        if (wanted.has(entry.name) || inRules) {
          reported.push(`${rel} (a link: loaded, not edited)`)
        }
      } else if (entry.isFile() && (wanted.has(entry.name) || isRule(rel))) {
        files.push(rel)
      }
    }
  }
  walk(dir)
  // The ancestors' instruction files: the CLIs read them too; they are not the project's.
  let up = dirname(resolve(dir))
  const above = [...wanted, join('.claude', 'CLAUDE.md'), join('.claude', 'rules')]
  for (;;) {
    for (const name of above) {
      if (existsSync(join(up, name))) reported.push(`${join(up, name)} (above the project)`)
    }
    if (dirname(up) === up) break
    up = dirname(up)
  }
  // Imports (@path) of Claude Code's files: loaded with them, reported, never edited.
  for (const rel of files) {
    if (!basename(rel).startsWith('CLAUDE') && !isRule(rel)) continue
    let text
    try {
      const problem = pathProblem(dir, rel)
      if (problem !== null) throw new Error(problem)
      text = readFileSync(join(dir, rel), 'utf8')
    } catch (e) {
      incomplete.push(`${rel}: ${(e as Error).message}`)
      continue
    }
    for (const m of text.matchAll(/(?:^|\s)@([~./\w-]\S*)/g)) {
      reported.push(`${m[1] ?? ''} (imported by ${rel})`)
    }
  }
  return { files: files.sort(), reported, incomplete }
}

// The manifest of the files as they are now: what the person approves. A file it cannot read
// (or that is no longer a regular file) is named in `unread`: discovery is then incomplete.
export const manifestOf = (
  dir: string,
  files: ReadonlyArray<string>,
): { readonly entries: ReadonlyArray<Entry>; readonly unread: ReadonlyArray<string> } => {
  const entries: Array<Entry> = []
  const unread: Array<string> = []
  for (const path of files) {
    try {
      const problem = pathProblem(dir, path)
      if (problem !== null) throw new Error(problem)
      const text = bytesOf(join(dir, path))
      entries.push({ path, hash: hashOf(text), premarked: unmarked(text) !== null })
    } catch (e) {
      unread.push(`${path}: ${(e as Error).message}`)
    }
  }
  return { entries, unread }
}

// ---- the writes (each idempotent; each reads the file before it acts)
export type Outcome =
  | { readonly _tag: 'Written' }
  | { readonly _tag: 'Done' }
  | { readonly _tag: 'Changed' } // the person changed it: never written, back to the person
  | { readonly _tag: 'Missing' }
  | { readonly _tag: 'Unsafe'; readonly why: string }
  | { readonly _tag: 'NoOriginal' } // a roll back with no kept original: not stripped by guess
// Reads a file the path check passed (a regular file, so no FIFO blocks the read).
const read = (path: string): string | null => (existsSync(path) ? bytesOf(path) : null)
const writeNew = (path: string, text: string, flag: string, mode = 0o644): void => {
  const fd = openSync(path, flag, mode)
  try {
    fchmodSync(fd, mode) // the mode exactly, whatever the umask
    writeFileSync(fd, Buffer.from(text, 'latin1')) // every byte (it loops over short writes)
  } finally {
    closeSync(fd)
  }
}

// Writes the text over the file only if nothing moved: a temporary file created exclusively beside
// it, with the file's mode; then, right before the rename, the whole path checked again (no link,
// plain folders, a regular file), the folders the same ones (device and inode), the same bytes.
// The temporary file never outlives a refusal or an error.
const publish = (
  dir: string,
  rel: string,
  seen: string,
  text: string,
  before: () => void,
): Outcome => {
  const path = join(dir, rel)
  const folders = folderIds(dir, rel)
  const mode = lstatSync(path).mode & 0o7777
  const tmp = join(dirname(path), `.${basename(path)}.aristoteles-${randomUUID()}`)
  let published = false
  try {
    writeNew(tmp, text, 'wx', mode)
    before()
    const problem = existsSync(path) ? pathProblem(dir, rel) : 'missing'
    if (problem !== null) return problem === 'missing' ? { _tag: 'Changed' } : { _tag: 'Unsafe', why: problem }
    if (folderIds(dir, rel) !== folders) {
      return {
        _tag: 'Unsafe',
        why: `a folder on the path was replaced (a temporary ${basename(tmp)} may remain in the moved folder)`,
      }
    }
    // a change of mode alone is the person's change too
    if ((lstatSync(path).mode & 0o7777) !== mode || read(path) !== seen) return { _tag: 'Changed' }
    renameSync(tmp, path)
    published = true
    return { _tag: 'Written' }
  } catch (e) {
    return { _tag: 'Unsafe', why: (e as Error).message }
  } finally {
    if (!published) {
      try {
        unlinkSync(tmp)
      } catch {
        // never created, or moved away with its folder (named in the refusal below)
      }
    }
  }
}
// The kept originals: a folder inside the project (`kept`, relative to it), every part of its
// path a plain folder (no link: checked before any folder is created), the last one private
// (0700); one file per approved hash (0600, a regular file, never a link), reused only when its
// bytes are that hash. An original is written whole to a private staging file first, then linked
// to its name (a hard link never replaces), so a crash leaves only a staging file to discard.
const keptPath = (dir: string, kept: string, entry: Entry): string => join(dir, kept, entry.hash)
const keptFolder = (dir: string, kept: string, create: boolean): string | null => {
  if (kept === '' || isAbsolute(kept) || kept.includes('\0') || normalize(kept) !== kept
    || kept.split(sep).some((part) => part === '..' || part === '.' || part === '')) {
    return `${kept}: the kept folder must be a plain relative path strictly inside the project`
  }
  const parts = kept.split(sep)
  let at = dir
  try {
    for (const [i, part] of parts.entries()) {
      at = join(at, part)
      let st
      try {
        st = lstatSync(at)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
        if (!create) return 'missing'
        mkdirSync(at, { mode: i === parts.length - 1 ? 0o700 : 0o755 })
        st = lstatSync(at)
      }
      if (st.isSymbolicLink() || !st.isDirectory()) return `${relative(dir, at)} is not a plain folder`
      if (i === parts.length - 1 && (st.mode & 0o077) !== 0) chmodSync(at, 0o700)
    }
    return null
  } catch (e) {
    return `${relative(dir, at)}: ${(e as Error).message}`
  }
}
// The kept original's text, null when there is none; a problem when it is not a plain file of
// that hash.
const keptText = (
  dir: string,
  kept: string,
  entry: Entry,
): { text: string | null; problem: string | null } => {
  const path = keptPath(dir, kept, entry)
  let st
  try {
    st = lstatSync(path)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { text: null, problem: null }
    return { text: null, problem: `${path}: ${(e as Error).message}` }
  }
  if (st.isSymbolicLink() || !st.isFile()) return { text: null, problem: `${path} is not a plain file` }
  const text = bytesOf(path)
  return hashOf(text) === entry.hash
    ? { text, problem: null }
    : { text: null, problem: `${path} does not hold the approved revision` }
}
const keepOriginal = (dir: string, kept: string, entry: Entry, text: string): string | null => {
  const folder = keptFolder(dir, kept, true)
  if (folder !== null) return folder
  const have = keptText(dir, kept, entry)
  if (have.problem !== null) return have.problem
  if (have.text !== null) return null
  const final = keptPath(dir, kept, entry)
  const staging = join(dir, kept, `.staging-${randomUUID()}`)
  try {
    writeNew(staging, text, 'wx', 0o600)
    linkSync(staging, final)
    return null
  } catch (e) {
    return `${final}: ${(e as Error).message}`
  } finally {
    try {
      unlinkSync(staging)
    } catch {
      // never created
    }
  }
}

// Marks one file: the original is kept first (in `kept`, a folder relative to the dir, by its hash), then the file is
// published. A file already marked is done; a changed one is never written. `before` runs just
// before the last check (a test's hook for an edit at that boundary).
export const markFile = (
  dir: string,
  kept: string,
  entry: Entry,
  before: () => void = () => {},
): Outcome => {
  const unsafe = safeEntry(dir, entry)
  if (unsafe !== null) return { _tag: 'Unsafe', why: unsafe }
  const path = join(dir, entry.path)
  const text = read(path)
  if (text === null) return { _tag: 'Missing' }
  const content = contentOf(text, entry)
  if (content === 'Marked') return { _tag: 'Done' }
  if (content === 'Other') return { _tag: 'Changed' }
  const keeping = keepOriginal(dir, kept, entry, text)
  if (keeping !== null) return { _tag: 'Unsafe', why: keeping }
  return publish(dir, entry.path, text, marked(text), before)
}

// Restores one file from its kept original (a roll back): only a file this activation marked is
// written back; an approved one already is the original; a pre-marked one keeps its line; a
// changed one is the person's and stays; with no kept original nothing is stripped by guess.
export const restoreFile = (
  dir: string,
  kept: string,
  entry: Entry,
  before: () => void = () => {},
): Outcome => {
  const unsafe = safeEntry(dir, entry)
  if (unsafe !== null) return { _tag: 'Unsafe', why: unsafe }
  const path = join(dir, entry.path)
  const text = read(path)
  if (text === null) return { _tag: 'Missing' }
  const content = contentOf(text, entry)
  if (content === 'Other') return { _tag: 'Changed' }
  if (content === 'Approved' || entry.premarked) return { _tag: 'Done' }
  const folder = keptFolder(dir, kept, false)
  if (folder === 'missing') return { _tag: 'NoOriginal' }
  if (folder !== null) return { _tag: 'Unsafe', why: folder }
  const original = keptText(dir, kept, entry)
  if (original.problem !== null) return { _tag: 'Unsafe', why: original.problem }
  if (original.text === null) return { _tag: 'NoOriginal' }
  return publish(dir, entry.path, text, original.text, before)
}

// The preflight: every entry is safe and still its approved revision (or marked over it, on a
// resume); no instruction file appeared that the manifest lacks; the walk was complete.
export const preflight = (
  dir: string,
  manifest: ReadonlyArray<Entry>,
  inventory: Inventory = inventoryOf(dir),
): ReadonlyArray<string> => {
  const problems: Array<string> = []
  const known = new Set(manifest.map((e) => e.path))
  for (const entry of manifest) {
    const unsafe = safeEntry(dir, entry)
    const text = unsafe === null ? read(join(dir, entry.path)) : null
    if (unsafe !== null) problems.push(`${entry.path}: ${unsafe}`)
    else if (text === null) problems.push(`${entry.path}: missing since it was approved`)
    else if (contentOf(text, entry) === 'Other') {
      problems.push(`${entry.path}: changed since it was approved`)
    }
  }
  for (const path of inventory.files) {
    if (!known.has(path)) problems.push(`${path}: new since the approval`)
  }
  for (const folder of inventory.incomplete) problems.push(`not read: ${folder}`)
  return problems
}
