// The commands of a step (P3): the words print only the intents of a step, each of which passed
// canAct. They build no role list, no decider order and no option of their own. A Wait prints
// no command.
import type { NextStep } from '../../core/derived/index.ts'
import type { Intent } from '../../core/schema/actions.ts'

type Of<K extends Intent['_tag']> = Extract<Intent, { readonly _tag: K }>

export const intentsOf = (step: NextStep): ReadonlyArray<Intent> =>
  step._tag === 'Do' ? step.intents : []
export const ofTag = <K extends Intent['_tag']>(
  step: NextStep,
  tag: K,
): ReadonlyArray<Of<K>> => intentsOf(step).filter((i): i is Of<K> => i._tag === tag)
export const has = (step: NextStep, tag: Intent['_tag']): boolean => ofTag(step, tag).length > 0

const unique = <A>(xs: ReadonlyArray<A>): ReadonlyArray<A> => [...new Set(xs)]
// The token before the ids of an agent's command; none for the person.
const lead = (token: string): string => (token === '' ? '' : `${token} `)
const or = (xs: ReadonlyArray<string>): string | undefined =>
  xs.length > 0 ? xs.join(', or ') : undefined

// The Give intents: one assign for each task, its roles joined by |.
export const assignOf = (step: NextStep, token = ''): string | undefined => {
  const gives = ofTag(step, 'Give')
  return or(
    unique(gives.map((g) => g.target.task)).map((task) => {
      const roles = gives.filter((g) => g.target.task === task).map((g) => g.target.role)
      return `work assign ${lead(token)}${task} --role=${roles.join('|')}`
    }),
  )
}

// The directions that the Suggest intents name.
export const suggestedOf = (step: NextStep): ReadonlyArray<string> =>
  ofTag(step, 'Suggest').flatMap((i) =>
    i.target.about._tag === 'Direction' ? [i.target.about.direction] : [],
  )
export const suggestOf = (step: NextStep, says: string): string | undefined => {
  const directions = suggestedOf(step)
  return directions.length > 0
    ? `work suggest ${directions.join('|')} --says="${says}"`
    : undefined
}

// The ReviseDirection intents, as one revise of their directions joined by |.
export const reviseOf = (step: NextStep, token: string, tail = ''): string | undefined => {
  const directions = ofTag(step, 'ReviseDirection').map((i) => i.target.direction)
  return directions.length > 0
    ? `work direction revise ${lead(token)}${directions.join('|')} --file=<edit.yaml>${tail}`
    : undefined
}

const review = (answers: string | null): string => (answers === null ? '' : ` --review=${answers}`)
export const splitOf = (step: NextStep, token = ''): string | undefined =>
  or(
    ofTag(step, 'SplitTask').map(
      (i) =>
        `work task split ${lead(token)}${i.target.task} --file=<parts.yaml>` +
        review(i.target.answers),
    ),
  )
export const remakeOf = (step: NextStep, reason: string, token = ''): string | undefined =>
  or(
    ofTag(step, 'RemakeTask').map(
      (i) =>
        `work task remake ${lead(token)}${i.target.task} --file=<task.yaml> ` +
        `--reason="${reason}"${review(i.target.answers)}`,
    ),
  )
// The commands of a step, in the order given; none for a Wait.
export const orOf = (...commands: ReadonlyArray<string | undefined>): string | undefined =>
  or(commands.filter((c): c is string => c !== undefined))

// What shortens a brief over its limit, from the step that answers it: shorter directions (a
// suggestion or a revise), a split, or a remake of one unit of work (B1). third: "splits".
export const shortenWords = (step: NextStep, task: string, third = false): string => {
  const s = third ? 's' : ''
  const shorter = suggestedOf(step).length > 0 || has(step, 'ReviseDirection')
  const ways = orOf(
    shorter ? `shorten${s} the directions of ${task}` : undefined,
    has(step, 'SplitTask') ? `split${s} ${task}` : undefined,
    has(step, 'RemakeTask') ? `remake${s} ${task}` : undefined,
  )
  return ways ?? `no act of the owner shortens ${task} now`
}
