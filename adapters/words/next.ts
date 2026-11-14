// The lines of `work next <token>`: the words of each step that nextFor gives, line for line as
// the old CLI wrote them (golden text). The steps are decided in core/derived/steps.ts; this
// file only writes them. PersonDecides is the step of a person's waiting item: waiting.ts prints
// it, so it has no line here. D14: the three bookkeeping steps (FinishChildOfClosedTask,
// FinishInClosedTask, FinishChild) are gone from nextFor, so they have no words.
import { claimOf, currentOf, exhaustionResult, itemAt, taskAt } from '../../core/derived/reads.ts'
import { isDo } from '../../core/derived/reads.ts'
import { leafName } from '../../core/derived/deciders.ts'
import type { Derived, NextStep, StepWhat } from '../../core/derived/index.ts'
import type {
  AssignmentId,
  DirectionId,
  EvaluationId,
  Standard,
  Stop,
  Suggestion,
  TaskId,
  Work,
} from '../../core/schema/index.ts'
import { clean } from '../../core/effects/lines.ts'
import { an, clock, short, stateWord, who } from './common.ts'
import {
  aboutId,
  attemptWords,
  draftWaitsText,
  stopIdOf,
} from './shared.ts'

// A step: its words, and its command when it has one.
const step = (what: string, command?: string): ReadonlyArray<string> =>
  command === undefined ? [what] : [what, `  ${command}`]

const nameOf = (w: Work, task: TaskId): string => w.tasks.get(task)?.name ?? task

const PROBLEM = '--says="<what happened, and how to fix it>"'
// The watcher stores a prompt line quoted already (clean): quote it once.
const unquoted = (line: string): string => line.replace(/^«(.*)»$/s, '$1')
const roleOfId = (w: Work, a: AssignmentId): string => w.assignments.get(a)?.role ?? a
const evaluationWord = (e: EvaluationId | null): string => e ?? 'the evaluation'
const asksWords = (w: Work, e: EvaluationId | null): string => {
  const improve = e === null ? '' : (w.evaluations.get(e)?.improve.join('; ') ?? '')
  return `${evaluationWord(e)} asks for: "${short(improve, 160)}"`
}
const reasonOf = (w: Work, review: string): string => {
  const item = itemAt(w, review)
  if (item === undefined) throw new Error(`the work has no review ${review}`)
  return item.reason ?? ''
}
const sectionOfTask = (w: Work, task: TaskId): string | null => {
  const section = taskAt(w, task).descriptionAi.context.section
  return section._tag === 'Section' ? section.id : null
}
// The standard of a direction's current version that a suggestion is about (itself, or the one
// that holds its rule).
const holderStandard = (
  w: Work,
  d: DirectionId,
  about: Suggestion['about'],
): Standard | undefined =>
  currentOf(w, d)
    .standards.map((e) => w.standards.get(e))
    .find(
      (s) =>
        s !== undefined &&
        (about._tag === 'Standard'
          ? s.entry === about.standard
          : about._tag === 'Rule' && s.rules.includes(about.rule)),
    )

// The token is shown only at assign; a parent that lost it ends the child and assigns again.
const lostToken = (w: Work, child: AssignmentId, task: TaskId, token: string): string => {
  const role = roleOfId(w, child)
  return (
    `  the token is the one that work assign printed for ${child}; give the same command to a ` +
    `new subagent. Only if you lost that token: work finish ${token} ${child}, then work assign ` +
    `${token} ${task} --role=${role}` +
    (isDo(w, role)
      ? ' (a new maker; when its latest try has a fault, the task waits for an evaluation first)'
      : '')
  )
}

// What stopped a task, as an evaluation step names it.
const stopWords = (w: Work, stop: Stop): string => {
  const sid = stopIdOf(stop)
  if (stop._tag === 'Exhaustion') {
    const x = w.exhaustions.get(stop.id)
    if (x === undefined) throw new Error(`the work has no exhaustion ${stop.id}`)
    const result = exhaustionResult(w, x)
    const reason = short(reasonOf(w, x.fault), 100)
    return `${result.by} used its last try on a fault (${sid}: ${result.id}, ${reason})`
  }
  // The person's Reject is one act: its first point speaks for it.
  const first = itemAt(w, `${stop.id}.1`)
  if (first === undefined) throw new Error(`the work has no review ${stop.id}.1`)
  return `${who(w, first.by)} rejected ${first.of.id} (${sid}): "${short(first.reason ?? '', 100)}"`
}

const linesOf = (d: Derived, s: StepWhat, token: string): ReadonlyArray<string> => {
  const w = d.moment.work
  switch (s._tag) {
    case 'ReadSource':
      return step(
        `read ${s.source} again: ${s.source}@${s.revision} was read at ${s.seenAt}, more than ` +
          `${s.hours} hours ago; then run work source ${token} ${s.source}@<its revision now>`,
      )
    case 'Answer':
      return step(
        `answer ${s.question}: ${short(w.questions.get(s.question)?.text ?? '', 200)}`,
        `work answer ${token} ${s.question} --text="<the answer>"`,
      )
    case 'Resolve':
      return step(
        `resolve ${s.escalation} on ${s.result}: ${reasonOf(w, s.escalation)}`,
        `work resolve ${token} ${s.escalation} ` +
          '--resolution="<the agreement, or the direction, in words>"',
      )
    case 'RecheckStaleSource':
      return step(
        `${s.result} was built on ${s.source}@${s.was}; ${s.source} is now at ${s.now}`,
        `work recheck ${token} ${s.result} --reason="${s.source} is now at ${s.now}"`,
      )
    case 'RecheckOldNeed': {
      const newer = `${s.newer} of ${s.need}`
      return step(
        `${s.result} was made before ${newer}; its maker reports again with that work`,
        `work recheck ${token} ${s.result} --reason="${newer} is newer; use it"`,
      )
    }
    case 'ReviewDraft': {
      const of = w.drafts.get(s.draft)?.of
      const name = of === undefined ? '' : (w.directions.get(of)?.name ?? of)
      return step(
        `review ${s.draft}: a draft of ${name} waits for your accept; read it, and ask each ` +
          'question of work guide direction-review',
        `work direction show ${s.draft}, then work review ${token} ${s.draft} accept ` +
          `--evidence="<where you read in ${s.draft}> | <what you saw>", ` +
          'or reject --reason="<why>"',
      )
    }
    case 'ReviseRejectedDraft': {
      const veto = itemAt(w, s.reject)
      if (veto === undefined) throw new Error(`the work has no review ${s.reject}`)
      const of = w.drafts.get(s.draft)?.of ?? ''
      return step(
        `${s.draft} is rejected by ${who(w, veto.by)}: "${short(veto.reason ?? '', 120)}"; ` +
          'revise the current version again',
        `work direction revise ${token} ${of} --file=<edit.yaml> --answers=${s.reject}`,
      )
    }
    case 'AnswerSuggestion': {
      const y = w.suggestions.get(s.suggestion)
      if (y === undefined) throw new Error(`the work has no suggestion ${s.suggestion}`)
      const needs =
        y.about._tag === 'Direction'
          ? `a draft that changes what ${s.direction} says`
          : `a draft that changes the standard ${holderStandard(w, s.direction, y.about)?.id}`
      return step(
        `${s.suggestion} suggests about ${aboutId(w, y.about)}: "${short(y.says, 120)}" ` +
          `(${who(w, y.by)}); answer it with ${needs}`,
        `work direction revise ${token} ${s.direction} --file=<edit.yaml> ` +
          `--answers=${s.suggestion}`,
      )
    }
    case 'PutOnBase': {
      const output = `${s.repo}@${s.commit}`
      return step(
        `put ${output} on ${s.base}: ${s.task} is accepted, and its commit is not on ${s.base} ` +
          'yet. When the repo has a rule for merges (a pull request), follow it; else run the ' +
          'example below. When the merge fails, or the base is protected, escalate with the error',
        `for example: git -C ${s.repo} checkout ${s.base} && git -C ${s.repo} merge ${s.commit}`,
      )
    }
    case 'FinishAcceptedTask':
      return step(`${s.task} is accepted: finish yourself`, `work finish ${token}`)
    case 'EvaluationWaitsForOwner':
      return step(
        `${s.evaluation} evaluates ${s.task} at the level ` +
          `${w.evaluations.get(s.evaluation)?.level}, and waits for ` +
          `${taskAt(w, s.task).owner.name}'s accept`,
      )
    case 'Evaluate':
      return step(
        `evaluate ${s.task}: ${stopWords(w, s.stop)}. Say what is wrong, why it cannot be ` +
          'done as asked, and what to improve; the level is that of the deepest cause',
        `work evaluate ${token} ${stopIdOf(s.stop)} --wrong="<what is wrong, with the results ` +
          'and the rules>" --why="<why it cannot be done as asked>" --improve="<one change; one ' +
          '--improve for each change>" --level=task|standard|direction|principle',
      )
    case 'WaitsForEvaluationBy':
      return step(
        `${s.task} waits for an evaluation by ${s.evaluator} (${roleOfId(w, s.evaluator)}): ` +
          stopWords(w, s.stop),
      )
    case 'WaitsForEvaluationNoHigh':
      return step(
        `${s.task} waits for an evaluation: ${stopWords(w, s.stop)}; no high role works on it, ` +
          'so the person assigns one',
      )
    case 'WaitsForParts':
      return step(`${s.task} waits for its parts, as ${evaluationWord(s.evaluation)} asks`)
    case 'DraftOfEvaluationWaits':
      return step(
        `${s.task}: ${s.draft} waits for the accept of ${draftWaitsText(d, s.draft)}; it is the ` +
          `change that ${evaluationWord(s.evaluation)} asks for (work direction show ${s.draft})`,
      )
    case 'WaitsForChangeOfEvaluation':
      return step(`${s.task} waits for the change that ${asksWords(w, s.evaluation)}`)
    case 'RemakeAsEvaluated':
    case 'EscalateForRemake': {
      const what = s.oneUnit
        ? 'remake it (its section is one unit, so it is not split)'
        : 'remake or split it'
      const eid = evaluationWord(s.evaluation)
      return step(
        `${s.task}: ${asksWords(w, s.evaluation)}; ${what}, then a new maker starts`,
        s._tag === 'RemakeAsEvaluated'
          ? `work task remake ${token} ${s.task} --file=<task.yaml> --reason="as ${eid} says"` +
              (s.oneUnit ? '' : `, or work task split ${token} ${s.task} --file=<parts.yaml>`)
          : `work escalate ${token} --reason="${s.task} needs the remake that ${eid} asks for"`,
      )
    }
    case 'ReviseAsEvaluated':
      return step(
        `${s.task}: ${asksWords(w, s.evaluation)}; draft that change, then a new maker starts ` +
          'when its deciders accept it',
        `work direction revise ${token} ${s.directions.join('|')} --file=<edit.yaml>`,
      )
    case 'ReviseForReturnedTask':
    case 'EscalateForReturnedTask':
      // The owner's own split or remake answers too (the old words name the owner for every
      // Reject of a task).
      return step(
        `${s.point} returns ${s.task}: "${reasonOf(w, s.point)}"; a direction change, or ` +
          `${taskAt(w, s.task).owner.name}'s own split or remake, answers it`,
        s._tag === 'ReviseForReturnedTask'
          ? `work direction revise ${token} ${s.directions.join('|')} --file=<edit.yaml>`
          : `work escalate ${token} --reason="${s.point} needs a direction change or a split ` +
            `of ${s.task}"`,
      )
    case 'WaitsForOutsideNeed':
      return step(
        `${s.task} waits for ${s.need} ${nameOf(w, s.need)} (${stateWord(d, s.need)}), which ` +
          'is outside your task tree; wait until it is accepted, or escalate if it must change',
      )
    case 'RunsAfter':
      return step(
        `${s.task} ${nameOf(w, s.task)} runs after ${s.need} ${nameOf(w, s.need)} ` +
          `(${stateWord(d, s.need)}); its maker starts when ${s.need} is accepted`,
      )
    case 'MediumRuns':
      return step(`${s.lead} (${roleOfId(w, s.lead)}) runs ${s.task} ${nameOf(w, s.task)}`)
    case 'RunSectionWithMedium':
      return step(
        `run ${s.task} with a medium role (its section ${sectionOfTask(w, s.task)} is one ` +
          'unit, so it is not split)',
        `work assign ${token} ${s.task} --role=${s.roles.join('|')}`,
      )
    case 'SplitFirst':
      return step(
        `split ${s.task} first, then give each part to a medium role`,
        `work task split ${token} ${s.task} --file=<parts.yaml>`,
      )
    case 'RunWithMedium':
      return step(
        `run ${s.task} ${nameOf(w, s.task)} with a medium role`,
        `work assign ${token} ${s.task} --role=${s.roles.join('|')}`,
      )
    case 'ChangeWaitsForDraft':
      return step(
        `${s.point} needs a direction change${s.first ? ' first' : ''}; ${s.drafts.join(', ')} ` +
          `waits for the accept of ${draftWaitsText(d, s.drafts[0])} ` +
          `(work direction show ${s.drafts[0]})`,
      )
    case 'ReviseForPoint':
    case 'EscalateForPoint':
      return step(
        `${s.point} needs a direction change${s.first ? ' first' : ''}: "${reasonOf(w, s.point)}"`,
        s._tag === 'ReviseForPoint'
          ? `work direction revise ${token} ${s.directions.join('|')} --file=<edit.yaml> ` +
              `--answers=${s.point}`
          : `work escalate ${token} --result=${s.result} ` +
            `--reason="${s.point} needs a direction change"`,
      )
    case 'MakerWaitsForFile': {
      const task = w.assignments.get(s.before)?.task
      return step(
        `${s.maker} waits for ${s.file}: ${s.before} (${task} ${task ? nameOf(w, task) : ''}) ` +
          'writes it first, and one maker writes a file at a time; ' +
          `start ${s.maker} when the file is free (work next says when)`,
      )
    }
    case 'MakerWorking':
      return step(
        `${s.maker} is working on ${s.task} (claimed since ${clock(claimedSince(w, s.maker))}); ` +
          'if its subagent stopped:',
        `work free ${token} ${s.maker}`,
      )
    case 'GiveMakerCommand':
      return [
        ...step(
          `${s.redo ? 'redo' : 'make'} ${s.task}: give a new subagent the command of ${s.maker} ` +
            `(${attemptWords(d, s.maker)})`,
          `work brief ${s.maker}.<the token that assign printed>`,
        ),
        ...(s.ownChild ? [lostToken(w, s.maker, s.task, token)] : []),
      ]
    case 'AssignMaker':
      return step(
        `make ${s.task} ${nameOf(w, s.task)}`,
        `work assign ${token} ${s.task} --role=${s.roles.join('|')}`,
      )
    case 'NoMakerRole':
      return step(
        `${s.task} needs a new result, and no lower role makes it`,
        `work escalate ${token} --reason="no role makes ${s.task}"`,
      )
    case 'CheckAgainUnderNewVersion':
      return step(`check ${s.result} again under the new version`)
    case 'ProgramChecksNextReport':
      return step(
        `${s.role} runs on the next report of ${s.task}; a recheck asks for one`,
        `work recheck ${token} ${s.result} --reason="check again under the new version"`,
      )
    case 'CheckYourself':
      return step(
        `check ${s.result} yourself`,
        `work review ${token} ${s.result} accept --evidence="<rule id> | <where> | <what>"`,
      )
    case 'CheckerWorking':
      return step(
        `${s.checker} is checking ${s.result} (claimed since ` +
          `${clock(claimedSince(w, s.checker))}); if its subagent stopped:`,
        `work free ${token} ${s.checker}`,
      )
    case 'GiveCheckerCommand':
      return [
        ...step(
          `check ${s.result}: give a new subagent the command of ${s.checker}; the same ` +
            'assignment checks each new result, with the token that work assign printed for it',
          `work brief ${s.checker}.<the token that assign printed>`,
        ),
        lostToken(w, s.checker, s.task, token),
      ]
    case 'CheckerOfHigherTier':
      return step(
        `${s.result} needs ${s.role}, which only a higher tier assigns`,
        `work escalate ${token} --result=${s.result} --reason="${s.result} needs ${s.role}"`,
      )
    case 'AssignChecker':
      return step(
        `check ${s.result} with ${s.role}`,
        `work assign ${token} ${s.task} --role=${s.role}`,
      )
    case 'Decide': {
      const output = w.results.get(s.result)?.output ?? ''
      return step(
        s.again ? `decide ${s.result} again under the new version` : `decide ${s.result}`,
        `work review ${token} ${s.result} accept --evidence="<the place in ${output} where you ` +
          'read it> | <what you saw there>", or reject it with --point',
      )
    }
    case 'WaitsForDecider':
      return step(`${s.result} waits for the accept of ${s.decider} (${roleOfId(w, s.decider)})`)
    case 'AssignDecider':
      return step(
        `${s.result} waits for the accept of ${an(s.role)}, and no ${s.role} works on ${s.task}`,
        `work assign ${token} ${s.task} --role=${s.role}`,
      )
    case 'DeciderByPerson': {
      const name = leafName(s.leaf)
      return step(
        `${s.result} waits for the accept of ${an(name)}, and no ${name} works on ${s.task}; ` +
          'the person assigns one',
      )
    }
    case 'PersonDecides':
      return []
    // Ruling 10.9: a brief over its limit is no refusal; it waits for a shorter brief.
    case 'BriefOverWaits':
      return step(
        `${s.assignment} waits: its brief has ${s.size} characters, and the limit of its tier ` +
          `is ${s.limit}; a high role shortens the directions of ${s.task}, or splits ${s.task}`,
      )
    // Ruling 10.10: the person reads the host's words beside the draft.
    case 'ExplainDraft': {
      const name = w.directions.get(s.direction)?.name ?? s.direction
      return step(
        `explain ${s.draft}: a change to the direction "${name}" waits for the person; write ` +
          'the problem and what you hope by the change, in plain words' +
          (s.dirWide ? ' (it comes from no project: the first host that writes them does it)' : ''),
        `work note ${token} words --on=${s.draft} --text="<the problem>" ` +
          '--hope="<what you hope by this change>"',
      )
    }
    // The notices (ruling 10.1): the lines that the watcher typed into a terminal before.
    case 'AnswerPrompt':
      return step(
        `${s.agent} waits at a prompt of its AI CLI: ${clean(unquoted(s.line))}. ` +
          'Answer it. When the prompt shows a failure of a system, record it: ' +
          `work problem ${token} ${s.task} ${PROBLEM}`,
        `work send ${token} ${s.agent} --text="<input>"`,
      )
    case 'RecordFailure': {
      const last = clean(s.lastLines.split('\n').slice(-3).join(' / '))
      return step(
        `${s.agent} failed 3 times (${s.why}). Its last lines: ${last} You cannot restart ` +
          'it: record a system problem, and the person resumes it.',
        `work problem ${token} ${s.task} ${PROBLEM}`,
      )
    }
    case 'WriteEndWords':
      return step(
        `the end of ${s.run} waits for the person. Read work guide decision-words, then ` +
          'write its words for the person.',
        `work note ${token} words --on=${s.run} --text="<the words>"`,
      )
    case 'TestProblem': {
      const says = clean(w.problems.get(s.problem)?.says ?? '', 300)
      const asked = s.asked === null ? '' : ' The person says that it is fixed now.'
      return step(
        `${s.problem} is not fixed: ${says}.${asked} Test it once, when your current step ` +
          'ends. When it works, record the fix.',
        `work problem ${token} ${s.problem} --fixed`,
      )
    }
    case 'WaitsForAnswer':
      return step(`your question ${s.question} waits for its answer.`)
    case 'Answered':
      return step(`your question ${s.question} has its answer.`, `work question show ${s.question}`)
    case 'Resolved':
      return step(
        `your escalation ${s.escalation} of ${s.result} is resolved; read the resolution.`,
        `work result show ${s.result}`,
      )
    case 'ShortenOrSplit':
      return step(
        `shorten the directions of ${s.task}, or split ${s.task}: the brief of ${s.assignment} ` +
          `has ${s.size} characters, and the limit of its tier is ${s.limit}`,
        (s.directions.length > 0
          ? `work direction revise ${token} ${s.directions.join('|')} --file=<edit.yaml>, or `
          : '') + `work task split ${token} ${s.task} --file=<parts.yaml>`,
      )
  }
}

// The time that an assignment holds its brief since; '' when it holds none.
const claimedSince = (w: Work, a: AssignmentId): string | undefined => {
  const claim = claimOf(w, a)
  return claim._tag === 'Free' ? undefined : claim.since
}

// The lines that work next prints (the old nextSteps text, line for line): what to do, then the
// command, indented by two. The token goes into every command that names the agent.
export const nextLines = (
  d: Derived,
  steps: ReadonlyArray<NextStep>,
  token: string,
): ReadonlyArray<string> => steps.flatMap((s) => linesOf(d, s.what, token))
