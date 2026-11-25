import { deviationCases } from '../../core/schema/index.ts'
import { directionRevision } from '../../core/services/index.ts'
// The views of the page, built from Derived and the files of the dir: the onboarding pages and
// the gear (the directions and the roles), the person, and the dir. The JSON is the view data of
// ui-model.ts part 4. The dashboard is built apart (dash.ts).
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import { ruleRefLocation, ruleRefText } from '../../core/effects/rules.ts'
import type { AiStatus } from '../live/status.ts'
import { spotCurrent, type Derived } from '../../core/derived/index.ts'
import { currentOf, rulesOfStandard, standardAt } from '../../core/derived/reads.ts'
import {
  type AnsweredQuestion,
  type AiQuestion,
  type DirectionCard,
  type DirectionView,
  type DraftChange,
  draftIn,
  type Direction,
  type Example,
  type ExampleView,
  type FlowStep,
  type FlowStepView,
  isSpot,
  onlyLead,
  type OnboardingDirection,
  type RoleCard,
  type RoleFile,
  type Settings,
  type Spot,
  type SpotView,
  type StandardFile,
  type Version,
  type Work,
  versionIdOf,
} from '../../core/schema/index.ts'
import type {
  DirView as DirViewSchema,
  OnboardingView as OnboardingViewSchema,
} from './contract.ts'
import { startStateOf } from '../../core/actions/index.ts'
import { type OnboardingFiles, sha } from '../../core/services/index.ts'
import { STATUS_MS, STATUS_WORDS } from '../live/status.ts'
import { startFixWords } from '../words/index.ts'
import { lineDiff } from './line-diff.ts'

// The views as the wire has them (the Schemas of contract.ts).
type DirView = typeof DirViewSchema.Type
type OnboardingView = typeof OnboardingViewSchema.Type

// What a view reads besides Derived: the dir and the settings now.
export interface ViewContext {
  readonly dir: string
  readonly settings: Settings
}

const workOf = (d: Derived): Work => d.moment.work


// --- the decisions that reach the person ----------------------------------------------------

// A step of the flow of a direction for the page: no place is null, an unmarked step uses none
// (Nanda, 2026-11-15). The cases are on the rules (pass 3b).
const flowStepView =
  (_exampleOf: (e: Example) => ExampleView) =>
  (s: FlowStep): FlowStepView => ({
    from: s.from,
    to: s.to,
    says: s.says,
    place: s.place ? { file: s.place.file, line: s.place.line ?? null } : null,
    uses: s.uses ?? [],
  })
const ruleEvidenceView = (
  evidence: import('../../src/domain/files.ts').RuleEvidence | undefined,
  exampleOf: (e: Example) => ExampleView,
) => {
  if (!evidence) return {}
  const { check, cases, knownBreaks, scope } = evidence
  return {
    result: check._tag === 'Command' ? check.result
      : check._tag === 'Reference' ? `${check.checker}: ${check.result}`
      : check._tag === 'Unknown' ? check.question : 'Check absent',
    examples: [
      ...cases.map(exampleOf),
      ...knownBreaks.filter((spot) => !cases.some((sample) => sample.fit === 'Breaks' &&
        'file' in sample.output && sample.output.file === spot.file && sample.output.line === spot.line &&
        sample.output.excerpt === spot.excerpt)).map((output) => exampleOf({ fit: 'Breaks', output })),
    ],
    searched: scope.searched,
    knownBreak: knownBreaks.length > 0,
  }
}

const standardsOf = (w: Work, v: Version<Direction>, { exampleOf, promptOf }: EvidenceReader): DirectionView['standards'] =>
  v.standards.map((entry) => {
    const s = standardAt(w, entry)
    return {
      id: s.id,
      says: s.says,
      rules: rulesOfStandard(w, s).map((r) => ({
        id: r.id,
        says: r.says,
        checkedBy: r.checkedBy._tag === 'Role' ? r.checkedBy.role : null,
        ...ruleEvidenceView(r.evidence, exampleOf), ...checkView(r, promptOf),
      })),
    }
  })


// The lines of a file around a spot (Nanda, 2026-11-15): the lines of its excerpt, at the place
// nearest to the line that the spot names, or that line when the excerpt is not there; and 3
// lines above and below. A long line is cut, so a minified file stays small on the page.
const AROUND = 3
const LINE_CHARS = 240
const aroundOf = (text: string | null, s: Spot): SpotView['around'] => {
  if (text === null) return []
  // A last line end starts no line of its own.
  const lines = text.replace(/\n$/, '').split('\n')
  const first = s.excerpt.trim().split('\n')[0]?.trim() ?? ''
  const holds = lines.flatMap((l, n) => (first && l.includes(first) ? [n] : []))
  const at = holds.sort((a, b) => Math.abs(a + 1 - s.line) - Math.abs(b + 1 - s.line))[0]
  const start = at ?? s.line - 1
  if (start < 0 || start >= lines.length) return []
  const end = at === undefined ? start : start + s.excerpt.trim().split('\n').length - 1
  const from = Math.max(0, start - AROUND)
  const to = Math.min(lines.length - 1, end + AROUND)
  return lines.slice(from, to + 1).map((l, k) => ({
    line: from + k + 1,
    text: l.length > LINE_CHARS ? `${l.slice(0, LINE_CHARS)}…` : l,
    mark: from + k >= start && from + k <= end,
  }))
}

// Each real sample of an example with its state and its code (ruling 4), and the host's words as
// they are: each file is read once a view.
const evidenceReader = (dir: string) => {
  const texts = new Map<string, string | null>()
  const textOf = (file: string): string | null => {
    if (!texts.has(file)) {
      try {
        texts.set(file, readFileSync(file, 'utf8'))
      } catch {
        texts.set(file, null)
      }
    }
    return texts.get(file) ?? null
  }
  const spotOf = (s: Spot): SpotView => {
    const text = textOf(join(dir, s.file))
    return { file: s.file, line: s.line, excerpt: s.excerpt, current: spotCurrent(text, s), around: aroundOf(text, s) }
  }
  const sampleOf = (s: Example['output']): ExampleView['output'] =>
    isSpot(s) ? spotOf(s) : s
  const exampleOf = (e: Example): ExampleView => ({
    fit: e.fit,
    input: e.input ? sampleOf(e.input) : null,
    output: sampleOf(e.output),
  })
  const promptOf = (ref: string): string | undefined => {
    const location = ruleRefLocation(ref)
    if (!location) return undefined
    try {
      const root = realpathSync(dir)
      const file = realpathSync(join(root, location.file))
      const local = relative(root, file)
      if (isAbsolute(local) || local.split(sep)[0] === '..' || !statSync(file).isFile()) return undefined
      const text = textOf(file)
      const prompt = text === null ? undefined : ruleRefText(text, location)
      return prompt?.trim() ? prompt : undefined
    } catch {
      return undefined
    }
  }
  return { exampleOf, promptOf }
}
type EvidenceReader = ReturnType<typeof evidenceReader>

const checkView = ({ test, ref }: { test?: string; ref?: string }, promptOf: EvidenceReader['promptOf']) => {
  const checkPrompt = !test && ref ? promptOf(ref) : undefined
  return { ...(test && { test }), ...(ref && { ref }), ...(checkPrompt && { checkPrompt }) }
}

// The words of a direction as one text for its diff (Nanda, 2026-11-15): the summary, the words,
// then each standard with each rule and its checker.
type Words = {
  readonly summary: string
  readonly says: string
  readonly standards: DirectionView['standards']
}
const wordsText = (v: Words): string =>
  [
    v.summary,
    v.says.trimEnd(),
    ...v.standards.map((s) =>
      [
        `Standard ${s.id}: ${s.says.trimEnd()}`,
        ...s.rules.map(
          (r) => `  Rule ${r.id} (checked by ${r.checkedBy ?? 'the decider'}): ${r.says.trimEnd()}`,
        ),
      ].join('\n'),
    ),
  ].join('\n\n')
// The words against the ones before them; with none before, every line comes.
const diffOf = (title: string, before: Words | undefined, now: Words): DraftChange => ({
  direction: title,
  lines: lineDiff(before ? wordsText(before) : '', wordsText(now)),
})
const standardsView = (standards: ReadonlyArray<StandardFile>, { exampleOf, promptOf }: EvidenceReader): DirectionView['standards'] =>
  standards.map((st) => ({
    id: st.id,
    says: st.says,
    rules: st.rules.map((rule) => ({ id: rule.id, says: rule.says, checkedBy: rule.checkedBy ?? null,
      ...ruleEvidenceView(rule.evidence, exampleOf), ...checkView(rule, promptOf) })),
  }))

const originOf = (asked: OnboardingDirection['asked']): string => {
  switch (asked._tag) {
    case 'Found':
      return 'found in the project by the host'
    case 'New':
      return 'asked for by the person'
    case 'AdoptedCompany':
      return `adapted from ${asked.path} of ${asked.repo}`
    case 'Company':
      return `a company direction: ${asked.path} of ${asked.repo}`
  }
}
// One file of .work/assess, for the directions page: its stage says what the card has.
const onboardingDirectionCard = (
  f: OnboardingDirection,
  evidence: EvidenceReader,
  discovery?: OnboardingFiles['discovery'],
): DirectionCard => {
  const { asked, stage } = f
  const { exampleOf } = evidence
  const drafted = draftIn(stage)
  const head = {
    ...(drafted ? { principles: drafted.from } : {}),
    ...(stage._tag === 'Ready' ? { revision: directionRevision(stage.draft, discovery) } : {}),
    id: f.id,
    name:
      drafted?.name ??
      (asked._tag === 'New' ? asked.principle : asked._tag === 'Company' ? asked.path : f.id),
    origin: originOf(asked),
    principle: asked._tag === 'New' ? asked.principle : null,
    example: asked._tag === 'New' ? asked.example : null,
  }
  const side = ({ words, source }: { words: string; source: { file: string; line: number; excerpt: string } }) => ({
    source: `${source.file}:${source.line}`,
    words: `${words}\n\n${source.excerpt}`,
  })
  const question = (q: AiQuestion) => {
    const target = q.target
    const sides = target?._tag === 'Candidates' ? [side(target.a), side(target.b)] as const
      : target?._tag === 'Deviation' ? [side(target.code), side(target.principle)] as const : undefined
    return {
      says: q.says,
      ...(q.example && { example: exampleOf(q.example) }),
      ...(sides && { sides }),
      ...(target?._tag === 'Deviation' && {
        rule: target.rule,
        caseSides: deviationCases(target).slice(1).map(({ code, principle }) => [side(code), side(principle)] as const),
      }),
      options: q.options,
    }
  }
  const answered = (q: AnsweredQuestion) => ({ ...question(q), answer: q.chosen })
  switch (stage._tag) {
    case 'Drafting':
      return { ...head, state: 'loading', why: 'drafting' }
    case 'Reset':
      return { ...head, state: 'loading', why: 'reset' }
    case 'Removed':
      return { ...head, state: 'removed' }
  }
  const wordsOf = (d: NonNullable<typeof drafted>) => {
    const words = { ...d.content, standards: standardsView(d.content.standards, evidence) }
    const last = d.previous
    return {
      ...words,
      flow: words.flow.map(flowStepView(exampleOf)),
      diff: diffOf(last ? 'The last draft → this draft' : 'The first draft: every line is new',
        last && { ...last, standards: standardsView(last.standards, evidence) }, words),
    }
  }
  switch (stage._tag) {
    case 'Question': {
      const [first, ...rest] = stage.open
      return { ...head, state: 'question', ...(stage.draft && { draft: wordsOf(stage.draft) }),
        ...(stage.revision && { revision: stage.revision }), open: [question(first), ...rest.map(question)] }
    }
    case 'Answered': {
      const [first, ...rest] = stage.answered
      return { ...head, state: 'loading', why: 'answered',
        ...(stage.draft && { draft: wordsOf(stage.draft) }), answered: [answered(first), ...rest.map(answered)] }
    }
    case 'Revising': {
      const { words } = stage
      const all = stage.answered.map(answered)
      return { ...head, state: 'loading', why: 'revise', words, ...(stage.checkerChanged && { checkerChanged: true as const }), draft: wordsOf(stage.draft), answered: all }
    }
    case 'Ready':
      return { ...head, state: 'ready', draft: wordsOf(stage.draft) }
    case 'Accepted':
      return { ...head, state: 'accepted', draft: wordsOf(stage.draft) }
  }
}

// The words of a card that its file does not hold: the summary, where the project has it, its
// state, a Revise that waits, and whether the page toggles its persistence.
type CardWords = Omit<RoleCard, '_tag' | 'role' | 'icon' | 'model' | 'launch' | 'persistence' | 'toggle'> & {
  readonly toggle: boolean
}
// What every card of a role shows, from its file and the settings of its model (ruling 10).
const roleCardOf = (settings: Settings, role: string, file: RoleFile, words: CardWords): RoleCard => {
  const { toggle, ...rest } = words
  if (file.kind === 'program') return { _tag: 'Program', role, icon: file.icon, ...rest }
  return {
    _tag: 'Agent',
    role,
    icon: file.icon,
    model: file.model,
    launch: settings.models[file.model]?.launch ?? null,
    persistence: file.persistence,
    toggle,
    ...rest,
  }
}

// Before the store: the onboarding files (ruling 1). The role of the top task has no toggle while
// it is the only persistent role that splits (ruling 15); the roles that the project has come first.
export const onboardingFilesView = (
  files: OnboardingFiles,
  settings: Settings,
  dir: string,
): OnboardingView => {
  const evidence = evidenceReader(dir)
  const lead = onlyLead(files.config?.roles ?? {})
  const roles = files.roles.map((r) =>
    roleCardOf(settings, r.role, r.file, {
      revision: sha(JSON.stringify(r)),
      ...(files.staffingAllowances?.[r.role] === undefined ? {} : { subagentAllowance: files.staffingAllowances[r.role] }),
      ...(r.role === lead ? { builtIn: 'host' as const }
        : r.file.kind === 'agent' && r.file.pipeline ? { builtIn: 'pipeline' as const } : {}),
      ...(r.principles ? { principles: r.principles } : {}),
      ...(r.directions ? { directions: r.directions } : {}),
      ...(r.questions ? { questions: r.questions } : {}),
      summary: r.summary,
      description: r.file.description,
      toggle: files.responsibilityOnly !== true && lead !== r.role,
      found: r.found._tag === 'InProject' ? r.found.path : null,
      state: r.decision._tag === 'Accepted' ? 'accepted' : 'waiting',
      request: r.decision._tag === 'Revising' ? r.decision.words : null,
    }),
  )
  return {
    stage: 'files',
    ...(files.roleRequests?.length ? { roleRequests: files.roleRequests } : {}),
    ...(files.discovery && { discovery: {
      summary: files.discovery.summary ?? 'Project discovery',
      read: files.discovery.sources.map((source) => `${source.file}:${source.line}`),
      notSearched: files.discovery.scope.unknown,
      app: files.discovery.app ?? null,
    } }),
    directions: files.directions.map((f) => onboardingDirectionCard(f, evidence, files.discovery)),
    roles: [...roles.filter((r) => r.found !== null), ...roles.filter((r) => r.found === null)],
    models: files.responsibilityOnly === true ? [] : Object.keys(settings.models),
    start: startViewOf(files),
  }
}
// What the agents page says of the store start: the one reader (startStateOf), in the words of
// work onboard status.
const startViewOf = (files: OnboardingFiles): OnboardingView['start'] => {
  const start = startStateOf(files)
  switch (start._tag) {
    case 'Blocked':
      return { state: 'blocked', says: start.refusal.message, fix: startFixWords(start.fix) }
    case 'Open':
      return { state: 'open' }
    default:
      return { state: 'waiting' }
  }
}

// After the store (the gear, ruling 13): the official directions with their examples, the roles of
// the stored config, and the adjustments that wait for the person.
export const onboardingStoreView = (d: Derived, ctx: ViewContext): OnboardingView => {
  const w = workOf(d)
  const evidence = evidenceReader(ctx.dir)
  const directions = [...w.directions.values()]
    .filter((x) => d.states.directions.get(x.id)?._tag === 'Official')
    .map((x): DirectionCard => {
      const v = currentOf(w, x.id)
      const from = x.source._tag === 'External' ? `, from ${x.source.path} of ${x.source.repo}` : ''
      const standards = standardsOf(w, v, evidence)
      const before = x._tag === 'Official' ? x.versions[v.number - 2] : undefined
      const title = before
        ? `${versionIdOf(before)} → ${versionIdOf(v)}`
        : `${versionIdOf(v)}, the first version: every line is new`
      const diff = diffOf(title, before && { ...before, standards: standardsOf(w, before, evidence) }, {
        ...v,
        standards,
      })
      return {
        id: x.id,
        name: x.name,
        state: 'current',
        origin: `${versionIdOf(v)}, owner ${x.owner.name}${from}`,
        principle: null,
        example: null,
        draft: {
          summary: v.summary,
          flow: v.flow.map(flowStepView(evidence.exampleOf)),
          says: v.says,
          standards,
          diff,
        },
      }
    })
  const roles = Object.entries(w.config.roles).map(([role, file]) =>
    roleCardOf(ctx.settings, role, file, {
      summary: file.description,
      description: file.description,
      toggle: false,
      found: null,
      state: 'current',
      request: null,
    }),
  )
  const models = Object.keys(ctx.settings.models)
  return { stage: 'store', directions, roles, models, start: { state: 'started' } }
}

// Ruling 10.8: who the page acts as, and the one line for a name that is no person of the dir.
export const personView = (
  people: ReadonlyArray<string>,
  name: string,
): { readonly name: string; readonly known: boolean; readonly line: string | null } => {
  const known = people.includes(name)
  if (known) return { name, known, line: null }
  const now = name === '' ? 'git user.name is not set' : `git user.name is "${name}"`
  const set =
    people.length === 1
      ? `Set it: git config user.name "${people[0]}"`
      : `Set your name, one of ${people.join(', ')}: git config user.name "<your name>"`
  return {
    name,
    known,
    line:
      `The page shows the items of the person that git names; ${now}, and that is no person ` +
      `of this dir. ${set}`,
  }
}

// P8, ruling 3: the toast of the dir view: the newest status of the AI, while it is fresh.
export const toastOf = (status: AiStatus | null, now: number): DirView['toast'] => ({
  status:
    status !== null && now - status.at < STATUS_MS
      ? { by: status.by, kind: status.kind, words: STATUS_WORDS[status.kind], text: status.text }
      : null,
})

export const dirView = (
  initialized: boolean,
  dir: {
    readonly name: string
    readonly path: string
    readonly settings: Settings
    readonly onboarding: boolean
    readonly hasConfig: boolean
    readonly startPrompt: string
    readonly status: AiStatus | null
    readonly now: number
    readonly picks: DirView['picks']
  },
): DirView => ({
  name: dir.name,
  path: dir.path,
  theme: dir.settings.theme,
  sound: dir.settings.sound,
  settings: dir.settings,
  hasConfig: dir.hasConfig,
  onboarding: dir.onboarding,
  initialized,
  startPrompt: dir.startPrompt,
  picks: dir.picks,
  toast: toastOf(dir.status, dir.now),
})
