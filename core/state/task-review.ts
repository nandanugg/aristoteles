import { Result, Schema } from 'effect'
import {
  PromptOutcome, Rationale, RetryCount, quoteIn, refuse, taskRules,
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
  const reviewed = facts.outcomes.filter(Schema.is(PromptOutcome))
  const reports = new Map(reviewed.map((outcome) => [outcome.rule.id, outcome]))
  if (reviewed.length !== facts.outcomes.length || reports.size !== prompts.length || facts.outcomes.length !== prompts.length || prompts.some((rule) =>
    JSON.stringify(rule) !== JSON.stringify(reports.get(rule.id)?.rule))) {
    return Result.fail(refuse('InvalidEvidence', Rationale.make('Supply one outcome for each pinned prompt rule.')))
  }
  const supported = (evidence: Of<typeof Evidence>) => evidence._tag === 'Quote'
    ? quoted(evidence, result)
    : phase.outcomes.some((outcome) => JSON.stringify(outcome.evidence) === JSON.stringify(evidence))
  if ([...facts.outcomes, ...facts.findings].some(({ evidence }) => !supported(evidence))) {
    return Result.fail(refuse('InvalidEvidence', Rationale.make('Cite a passage in the result or its captured command output.')))
  }

  const outcomes = [...phase.outcomes, ...reviewed]
  const finding = facts.findings[0]
  if (finding) return Result.succeed({ _tag: 'Raised', reason: 'NoRule', evidence: finding.evidence })
  const [first, ...rest] = outcomes.filter((outcome): outcome is BreakingOutcome => outcome._tag === 'Breaks' && !knownBreak(outcome, result))
  if (!first) return Result.succeed({ _tag: 'Done', result, outcomes })
  const attempt = result.attempt
  const history = attempt.feedback._tag === 'Review' ? attempt.feedback.breaks : []
  const repeated = [first, ...rest].find((now) => history.some((was) => was.rule.id === now.rule.id))
  if (repeated) return Result.succeed({ _tag: 'Raised', reason: 'Misses', evidence: repeated.evidence })
  if (attempt.retryCount >= limit) {
    return Result.succeed({ _tag: 'Raised', reason: 'Tries', evidence: first.evidence })
  }
  const retryCount = attempt.retryCount + 1
  if (!Schema.is(RetryCount)(retryCount)) return Result.fail(refuse('InvalidInput', Rationale.make('The retry count exceeds its limit.')))
  return Result.succeed({
    _tag: 'Working', attempt: { ...attempt, retryCount, feedback: { _tag: 'Review', breaks: [first, ...rest, ...history] } },
  })
}

export const reviewMove = (phase: ReviewedPhase) =>
  phase._tag === 'Done' ? 'next' : phase._tag === 'Working' ? 'back' : 'raise'
