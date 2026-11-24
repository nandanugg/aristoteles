// The act the model took (read from the trace's picks), as the TS core's Act on the TS state. The
// fields the model has no word for are filled as an honest sender and the harness would: a basis
// from the state, the ask ids found by (kind, from, to, about), `caught` and `holds` from the
// model's truths, a rule's evidence from its form.
import { vsum } from '../../../state/c16/reads.ts'
import type { WorkState } from '../../../state/c16/state.ts'
import {
  type Act,
  type Actor,
  type AnswerBody,
  type Body,
  type OpenAsk,
  type QuestionBody,
  type QuestionForm,
  type Reply,
  keyOf,
  pairKey,
} from '../../../state/c16/types.ts'
import type { ItemKey, ItemRec, Level, TaskSpec, Verdict } from '../../../state/c16/data.ts'
import { basisOf } from '../accept.ts'
import { type Plain, picked } from './itf.ts'
import { EDIT, type MAsk, type MStore, applies } from './model.ts'
import { type Ctx, KEY, ROLE, actorOfName, askText, sectionsOf } from './project.ts'

// A model act: its sender, and its body (a tag alone, or { tag, value }).
export interface ModelAct {
  readonly who: string
  readonly tag: string
  readonly value: { readonly [field: string]: Plain }
}
type Fields = { readonly [field: string]: Plain }
const split = (b: Plain): { readonly tag: string; readonly value: Fields } =>
  typeof b === 'string' ? { tag: b, value: {} } : (() => {
    const v = b as { readonly tag: string; readonly value: Plain }
    return { tag: v.tag, value: v.value as { readonly [f: string]: Plain } }
  })()

const ask = (value: Plain): MAsk => value as unknown as MAsk
const text = (p: Plain | undefined): string => p as string
const num = (p: Plain | undefined): number => p as number
const list = (p: Plain | undefined): ReadonlyArray<string> => p as ReadonlyArray<string>

// The model's act of a step of the trace: the picked act, or the one the action built.
export const modelActOf = (
  action: string,
  picks: { readonly [name: string]: Plain },
  pre: MStore,
): ModelAct => {
  const act = picked(picks['act'])
  if (act !== null) {
    const a = act as { readonly who: string; readonly body: Plain }
    return { who: a.who, ...split(a.body) }
  }
  const pick = (name: string): Plain => {
    const p = picked(picks[name])
    if (p === null) throw new Error(`${action}: no pick ${name}`)
    return p
  }
  const question = (from: string, to: string): MAsk => ({ kind: 'Question', from, to, about: -1 })
  switch (action) {
    case 'personStep': {
      const step = split(pick('step'))
      if (step.tag !== 'Respond') return { who: 'Human', ...step }
      const reply = text(pick('reply'))
      const resolvesFight = picked(picks['resolvesFight']) ?? false
      const breaksTasks = picked(picks['breaksTasks']) ?? []
      return {
        who: 'Human',
        tag: 'Respond',
        value: { ask: step.value['ask']!, reply, resolvesFight, breaksTasks },
      }
    }
    case 'exitHappens':
      return { who: 'Harness', tag: 'Exit', value: { actor: pick('actor') } }
    case 'askStep': {
      const from = text(pick('asker'))
      return {
        who: from,
        tag: 'Open',
        value: question(from, text(pick('answerer'))) as unknown as { [f: string]: Plain },
      }
    }
    // the rogue maker: a question to its role, or past the cap its AskRaise
    case 'putAsk': {
      const maker = text(pick('maker'))
      const over = (pre.askCount.get(JSON.stringify([maker, 'Role'])) ?? 0) >= 2
      const q = question(maker, 'Role') as unknown as { [f: string]: Plain }
      return { who: maker, tag: over ? 'AskRaise' : 'Open', value: q }
    }
    default:
      throw new Error(`no act for action ${action}`)
  }
}

// The text of a model told step, for the check that the step the model took was told.
export const toldTextOf = (m: ModelAct): string | null => {
  const a = ask(m.value as unknown as Plain)
  switch (m.tag) {
    case 'Open':
      return a.kind !== 'Execute' || a.to === 'Pipe'
        ? null
        : a.from === 'Host'
        ? 'Open:send'
        : `Open:make:${a.about}`
    case 'Hear':
    case 'AnswerQuestion':
      return `${m.tag}:${a.kind}|${a.from}|${a.to}|${a.about}`
    case 'Review':
    case 'Respond': {
      const x = ask(m.value['ask']!)
      return `${m.tag}:${x.kind}|${x.from}|${x.to}|${x.about}`
    }
    case 'Reassign':
    case 'TopDone':
    case 'EndProject':
      return m.tag
    default:
      return null
  }
}

// --- the TS act ----------------------------------------------------------------------------------

const FORMS: ReadonlyArray<QuestionForm> = [
  { _tag: 'Single' },
  { _tag: 'Multiple', questions: [{ description: 'a', placeholder: '' }, {
    description: 'b',
    placeholder: '',
  }] },
  { _tag: 'Choice', options: ['x', 'y', 'z'], multi: true },
  { _tag: 'Matrix', rows: ['r1', 'r2'], columns: ['c1', 'c2'] },
]
const answerOf = (f: QuestionForm): AnswerBody => {
  switch (f._tag) {
    case 'Single':
      return { _tag: 'Single', text: 'a' }
    case 'Multiple':
      return { _tag: 'Multiple', texts: f.questions.map(() => 'a') }
    case 'Choice':
      return { _tag: 'Choice', picked: [0, 1] }
    case 'Matrix':
      return { _tag: 'Matrix', cells: f.rows.map(() => 0) }
  }
}

const RULE_REC = (rec: ItemRec, form: string, says: string): ItemRec => {
  const mech = form === 'Mech' || form === 'Both'
  const ref = form === 'Ref' || form === 'Both'
  return {
    ...rec,
    says,
    form: form === 'NoForm' ? 'none' : mech ? (ref ? 'both' : 'mech') : 'ref',
    test: mech ? 'check' : null,
    ref: ref ? 'f#a:1-2' : null,
  }
}

const keys = (names: ReadonlyArray<string>): ReadonlySet<ItemKey> =>
  new Set(names.map((x) => KEY[x]!))

const spec = (slot: number, sections: ReadonlyArray<string>, outputHld = false): TaskSpec => ({
  name: `t${slot}`,
  goal: 'g',
  sections,
  facts: outputHld ? { output: 'hld' } : {},
  role: ROLE,
})

// The replay writes an existing rule to exercise the model's evidence-form transition.
// A person edit has no task slot, so use the first rule in that case.
const ruleForFix = (fix: number): ItemKey => fix === EDIT ? 'rule:0' : `rule:${fix}`
const otherRules = (fix: number): ReadonlyArray<ItemKey> =>
  ['rule:0', 'rule:1'].filter((x) => x !== ruleForFix(fix))

export const tsAct = (
  m: ModelAct,
  pre: MStore,
  post: MStore,
  s: WorkState,
  c: Ctx,
  n: number,
  resolvesFight: boolean,
): Act => {
  const who: Actor = actorOfName(c, m.who)
  const slotTask = (slot: number): string => c.slotTask.get(slot) ?? `?${slot}`
  const fixId = (fix: number): string => (fix === EDIT ? 'edit' : slotTask(fix))
  const find = (from: Iterable<OpenAsk>, a: MAsk): string => {
    const want = `${a.kind}|${a.from}|${a.to}|${a.about}`
    const found = [...from].find((x) => askText(c, x) === want)
    return found?.id ?? `?${want}`
  }
  const open = [...s.asks.values()]
  const heard = [...s.answered.values()].map((x) => x.ask)
  const v = m.value
  const body = ((): Body => {
    switch (m.tag) {
      case 'Open': {
        const a = ask(v as unknown as Plain)
        if (a.kind === 'Question') {
          const count = s.askCount.get(pairKey(who, actorOfName(c, a.to))) ?? 0
          const question: QuestionBody = {
            title: 'q',
            form: FORMS[count % FORMS.length]!,
          }
          const to = actorOfName(c, a.to)
          return { _tag: 'Open', open: { _tag: 'OpenQuestion', to, question } }
        }
        if (a.from === 'Host') {
          const sp = spec(a.about, sectionsOf(a.about, c.sections), post.tasks.get(a.about)?.outputHld)
          return { _tag: 'Open', open: { _tag: 'OpenSend', spec: sp } }
        }
        if (a.from === 'Role') {
          return { _tag: 'Open', open: { _tag: 'OpenMake', task: slotTask(a.about) } }
        }
        return {
          _tag: 'Open',
          open: { _tag: 'OpenReject', task: slotTask(a.about), points: ['p'] },
        }
      }
      case 'AskRaise':
        return { _tag: 'AskRaise', to: actorOfName(c, ask(v as unknown as Plain).to) }
      case 'Hear':
        return { _tag: 'Hear', ask: find(heard, ask(v as unknown as Plain)) }
      case 'AnswerQuestion': {
        const id = find(open, ask(v as unknown as Plain))
        const form = s.asks.get(id)?.question?.form ?? FORMS[0]!
        return { _tag: 'AnswerQuestion', ask: id, answer: answerOf(form) }
      }
      case 'Report': {
        const a = ask(v['ask']!)
        const slot = a.about
        const bad = post.tasks.get(slot)?.badResult === true
        const catching = ['R0', 'R1'].filter((r) =>
          applies(pre, r, slot) && pre.ruleForm.get(Number(r.slice(1))) === 'Mech'
        )
        return {
          _tag: 'Report',
          ask: find(open, a),
          output: 'o',
          files: [],
          caught: bad ? keys(catching) : new Set(),
        }
      }
      case 'Review': {
        const verdict = text(v['verdict']) as Verdict
        return {
          _tag: 'Review',
          ask: find(open, ask(v['ask']!)),
          verdict,
          points: verdict === 'Pass' ? [] : ['p'],
        }
      }
      case 'Respond': {
        const reply = text(v['reply']) as Reply
        return {
          _tag: 'Respond',
          ask: find(open, ask(v['ask']!)),
          reply,
          points: reply === 'SendItBack' ? ['p'] : [],
        }
      }
      case 'Reassign':
      case 'TopDone':
      case 'EndProject':
        return { _tag: m.tag }
      case 'Resume':
      case 'ReadBrief': {
        const a = actorOfName(c, text(v['maker']))
        return { _tag: m.tag, maker: a._tag === 'Maker' ? a.id : '?' }
      }
      case 'Evaluate': {
        const fix = num(v['fix'])
        const finding = v['finding'] as unknown as { tag: string; value: { [f: string]: Plain } }
        const task = s.tasks.get(slotTask(fix))
        const base = { _tag: 'Evaluate', fix: fixId(fix), summary: 'cause' } as const
        if (finding.tag === 'Splits') {
          const parts = (task?.sections ?? []).map((x, index) =>
            spec(fix, [x], index === 0 && finding.value['addsOutput'] === true))
          return { ...base, level: 'Split', parts, roleDraft: null }
        }
        if (finding.tag === 'FitsRole') {
          const card = s.cards.get(ROLE)
          const only = finding.value['only'] === true
          return {
            ...base,
            level: 'Fit',
            parts: [],
            roleDraft: { role: ROLE, words: `w${n}`, model: only ? card?.model ?? 'm' : `m${n}` },
          }
        }
        return { ...base, level: text(finding.value['level']) as Level, parts: [], roleDraft: null }
      }
      case 'Advance':
        return { _tag: 'Advance', fix: fixId(num(v['fix'])) }
      case 'WriteRule': {
        const fix = num(v['fix'])
        const rule = ruleForFix(fix)
        const rec = RULE_REC(s.items.get(rule)!, text(v['form']), `r${n}`)
        // the role's claim of the other rules its rule contradicts: only for a rule with no test
        // command (a test command's verdict comes with RunTest)
        const mech = text(v['form']) === 'Mech' || text(v['form']) === 'Both'
        const fights = v['fights'] === true && !mech ? otherRules(fix) : []
        return { _tag: 'WriteRule', fix: fixId(fix), rule, rec, refOk: v['refOk'] === true, fights }
      }
      case 'RunTest': {
        const fix = num(v['fix'])
        return {
          _tag: 'RunTest',
          fix: fixId(fix),
          own: v['passed'] === true,
          contra: v['contradicts'] === true
            ? otherRules(fix)
            : [],
        }
      }
      case 'Ship': {
        const fix = num(v['fix'])
        const form = pre.fixes.get(fix)?.form ?? 'Ref'
        const draft = new Map<ItemKey, ItemRec | null>(
          list(v['real']).map((x) => {
            const key = KEY[x]!
            const cur = s.items.get(key)!
            const edited = { ...cur, says: `x${n}` }
            // a rule is the record WriteRule wrote (a Ship changes the items, never the evidence)
            const written = s.fixes.get(fixId(fix))?.draft.get(key)
            const next = x.startsWith('R') ? written ?? RULE_REC(cur, form, `x${n}`) : edited
            return [key, next]
          }),
        )
        return {
          _tag: 'Ship',
          fix: fixId(fix),
          items: keys(list(v['items'])),
          draft,
          resolvesFight,
        }
      }
      case 'LoopReview':
        return { _tag: 'LoopReview', mode: 'self-review turns', fix: fixId(num(v['fix'])), toPerson: v['toPerson'] === true }
      case 'RecheckDone':
        return {
          _tag: 'RecheckDone',
          task: slotTask(num(v['task'])),
          items: keys(list(v['items'])),
          holds: v['holds'] === true,
        }
      case 'RunRule':
        return {
          _tag: 'RunRule',
          task: slotTask(num(v['task'])),
          holds: pre.tasks.get(num(v['task']))?.broken !== true,
        }
      case 'Revive':
      case 'Exit':
        return { _tag: m.tag, actor: actorOfName(c, text(v['actor'])) }
      default:
        throw new Error(`no TS act for ${m.tag}`)
    }
  })()
  const act: Act = {
    id: `r${n}`,
    who,
    ep: s.ep.get(keyOf(who)) ?? 0,
    seen: basisOf(s, body),
    seenVer: vsum(s),
    vers: s.ver,
    old: false,
    body,
  }
  return act
}
