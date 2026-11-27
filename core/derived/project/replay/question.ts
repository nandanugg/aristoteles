import { picked } from './itf.probe.ts'
import { integer, record, type readTrace } from './driver.ts'

type QuestionObservation = {
  readonly phase: 'Open' | 'Answered'
  readonly recipient: number
  readonly answer: number | null
  readonly accepted: number
  readonly lifetime: number
}

export interface QuestionPort {
  readonly replace: () => Promise<void>
  readonly answer: (actor: number, message: number) => Promise<'Committed' | 'WrongActor' | 'WrongMove'>
  readonly observe: () => Promise<QuestionObservation>
}

type Kind = 'success' | 'fault' | 'mutant'
type Trace = ReturnType<typeof readTrace>

const snapshot = (step: Trace['states'][number]): QuestionObservation => {
  const question = record(step.state.question!)
  const { tag, value } = question
  const lifetime = integer(record(record(step.state.session!).value!).lifetime)
  const accepted = integer(step.state.accepted)
  if (tag === 'Open') return { phase: 'Open', recipient: integer(value), answer: null, accepted, lifetime }
  if (tag === 'Answered') {
    const answer = record(value!)
    return { phase: 'Answered', recipient: integer(answer.recipient), answer: integer(answer.text), accepted, lifetime }
  }
  throw new Error('Unknown question state in replay')
}

const compare = (actual: QuestionObservation, expected: QuestionObservation): void => {
  for (const field of ['phase', 'recipient', 'answer', 'accepted', 'lifetime'] as const) {
    if (actual[field] !== expected[field])
      throw new Error('Question replay differs for ' + field + ': ' + JSON.stringify({ expected, actual }))
  }
}

export const replayQuestionAnswer = async (trace: Trace, kind: Kind, port: QuestionPort): Promise<void> => {
  let previous = snapshot(trace.states[0]!)
  let wrong = false
  let duplicate = false
  compare(await port.observe(), previous)
  for (const step of trace.states.slice(1)) {
    const expected = snapshot(step)
    switch (step.action) {
      case '': break
      case 'replace': await port.replace(); break
      case 'submitAnswer': {
        const actor = integer(picked(step.picks.actor))
        const result = await port.answer(actor, integer(picked(step.picks.message)))
        const guarded = previous.phase === 'Open' && actor !== previous.recipient
        if (kind === 'mutant' && guarded && expected.phase === 'Answered') {
          if (result !== 'WrongActor') throw new Error('Production accepted the mutant answer')
          compare(await port.observe(), previous)
          return
        }
        if (previous.phase === 'Answered' && actor === previous.recipient && result !== 'WrongMove')
          throw new Error('Production accepted a repeated answer')
        wrong ||= guarded && result === 'WrongActor'
        duplicate ||= previous.phase === 'Answered' && actor === previous.recipient && result === 'WrongMove'
        break
      }
      default: throw new Error('Unknown question action: ' + step.action)
    }
    compare(await port.observe(), expected)
    if (wrong !== step.state.wrong || duplicate !== step.state.duplicate) throw new Error('Question replay differs on refusals')
    previous = expected
  }
  if (kind === 'mutant') throw new Error('Question mutant did not try a non-recipient')
}
