import { Result } from 'effect'
import {
  Rationale, quoteIn, refuse, ruleCoverage, taskRules,
  type BreakingOutcome, type Evidence, type Of, type Quote, type Refusal, type RetryLimit, type Task, type TaskPhase, type ReviewFacts,
} from '../schema/project.ts'

const quoted = (quote: Of<typeof Quote>, result: Extract<TaskPhase, { _tag: 'Reviewing' }>['result']) => {
  const file = result.files.find(({ path }) => path === quote.file)
  if (!file) return false
  return quoteIn(quote, file.image._tag === 'Present' ? file.image.contents : file.image.previousContents) === 'Found'
}

const knownBreak = (outcome: BreakingOutcome, result: Extract<TaskPhase, { _tag: 'Reviewing' }>['result']) => {
  const { rule, evidence } = outcome
  if (evidence._tag !== 'Quote') return false
  const { first, last } = evidence.lines
  return rule.knownBreaks.some((known) => known.file === evidence.file && known.text === evidence.text &&
    known.lines.first === first && known.lines.last === last) &&
    result.files.some((file) => file.path === evidence.file && file.image._tag === 'Present' &&
      !file.changed.some((lines) => lines.first <= last && first <= lines.last))
}

type ReviewedPhase = Extract<TaskPhase, { _tag: 'Done' | 'Raised' | 'Working' }>

export const reviewTask = (
  task: Task, phase: Extract<TaskPhase, { _tag: 'Reviewing' }>, facts: ReviewFacts, limit: Of<typeof RetryLimit>,
): Result.Result<ReviewedPhase, Refusal> => {
  const { result } = phase
  const prompts = taskRules(task).filter(({ verification }) => verification._tag === 'Prompt')
  if (ruleCoverage(prompts, facts.outcomes) !== 'Complete')
    return Result.fail(refuse('InvalidEvidence', Rationale.make('Supply one outcome for each pinned prompt rule.')))
  const supported = (evidence: Of<typeof Evidence>) => evidence._tag === 'Quote'
    ? quoted(evidence, result)
    : phase.outcomes.some((outcome) => JSON.stringify(outcome.evidence) === JSON.stringify(evidence))
  if ([...facts.outcomes, ...facts.findings].some(({ evidence }) => !supported(evidence))) {
    return Result.fail(refuse('InvalidEvidence', Rationale.make('Cite a passage in the result or its captured command output.')))
  }

  const outcomes = [...phase.outcomes, ...facts.outcomes]
  const [first, ...rest] = outcomes.filter((outcome): outcome is BreakingOutcome => outcome._tag === 'Breaks' && !knownBreak(outcome, result))
  const retained: Extract<TaskPhase, { _tag: 'Raised' }>['retained'] = {
    _tag: 'Retained', result, outcomes, feedback: first ? { _tag: 'Review', breaks: [first, ...rest] } : { _tag: 'None' },
  }
  const fix = { _tag: 'Unassessed' } as const
  const [finding, ...otherFindings] = facts.findings
  if (finding) return Result.succeed({
    _tag: 'Raised', reason: 'NoRule', retained, fix, evidence: [finding.evidence, ...otherFindings.map(({ evidence }) => evidence)],
  })
  if (!first) return Result.succeed({ _tag: 'Done', result, outcomes, accepted: { _tag: 'Reviewed' } })
  const attempt = result.attempt
  const history = attempt.feedback._tag === 'Review' ? attempt.feedback.breaks : []
  const [repeated, ...otherRepeated] = [first, ...rest].filter((now) =>
    history.some((was) => JSON.stringify(was.rule) === JSON.stringify(now.rule)))
  if (repeated) return Result.succeed({
    _tag: 'Raised', reason: 'Misses', retained, fix, evidence: [repeated.evidence, ...otherRepeated.map(({ evidence }) => evidence)],
  })
  if (task.retryCount >= limit) return Result.succeed({
    _tag: 'Raised', reason: 'Tries', retained, fix, evidence: [first.evidence, ...rest.map(({ evidence }) => evidence)],
  })
  return Result.succeed({
    _tag: 'Working', attempt: { ...attempt, feedback: { _tag: 'Review', breaks: [first, ...rest, ...history] } },
  })
}

export const reviewMove = (phase: ReviewedPhase) =>
  phase._tag === 'Done' ? 'next' : phase._tag === 'Working' ? 'back' : 'raise'
