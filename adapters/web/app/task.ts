import { useEffect, useState } from 'preact/hooks'
import { html } from 'htm/preact'
import { Result } from 'effect'
import { ReviewInput } from './review-input.ts'
import type { ProposalReply } from './project-api.ts'
import { ReviewEvidence } from './project-evidence.ts'
import { Rationale, takeAsIsEligibility, roleOf, taskRole, taskRules, type Project, type Refusal, type Submission, type Task, type TaskKey, type Of, type WholeFile } from '../../../core/schema/project.ts'

function FileResult({ file }: { readonly file: WholeFile }) {
  const { image } = file
  const contents = image._tag === 'Present' ? image.contents : image.previousContents
  const lines = contents.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return html`<details>
    <summary>${file.path}${image._tag === 'Deleted' ? ' · Deleted' : ''}</summary>
    <pre><code>${lines.map((line, index) => {
      const number = index + 1
      return file.changed.some(({ first, last }) => number >= first && number <= last)
        ? html`<mark>${line}${'\n'}</mark>` : line + '\n'
    })}</code></pre>
  </details>`
}

export function TaskPanel({ task, project, commandBlock, submit }: {
  readonly task: Task
  readonly project: Project
  readonly submit?: (submission: Submission) => Promise<ProposalReply>
  readonly commandBlock?: (key: Of<typeof TaskKey>) => Promise<Refusal['why'] | null>
}) {
  const { phase } = task
  const [failure, setFailure] = useState<Refusal | null>(null)
  const choose = async (move: 'takeAsIs' | 'drop', why: string) => {
    if (!submit) return
    const result = await submit({ line: 'Task', key: task.key, read: project.read, move, input: { why: Rationale.make(why) } })
    setFailure(Result.isFailure(result) ? result.failure : null)
  }
  const [blocked, setBlocked] = useState<Refusal['why'] | null>(null)
  useEffect(() => {
    setBlocked(null)
    if (!commandBlock || phase._tag !== 'ReadyToReview') return
    let current = true
    const update = () => { void commandBlock(task.key).then((why) => { if (current) setBlocked(why) }, () => {}) }
    update()
    const timer = setInterval(update, 1000)
    return () => { current = false; clearInterval(timer) }
  }, [task.key, task.changedIn, phase._tag, commandBlock])
  const raised = phase._tag === 'Raised' ? phase : undefined
  const retained = raised?.retained._tag === 'Retained' ? raised.retained : undefined
  const proposal = raised?.fix._tag === 'Proposed' ? project.proposals.get(raised.fix.proposal) : undefined
  const result = phase._tag === 'ReadyToReview' || phase._tag === 'Reviewing' || phase._tag === 'Done' ? phase.result : retained?.result
  const feedback = phase._tag === 'Working' ? phase.attempt.feedback : phase._tag === 'Sent' ? phase.feedback : null
  const outcomes = phase._tag === 'Reviewing' || phase._tag === 'Done' ? phase.outcomes : retained?.outcomes
  return html`<article aria-label=${task.name}>
    <h3>${task.name}</h3><p>${task.goal}</p>
    <p>${roleOf(project, taskRole(task))?.name ?? taskRole(task)} · ${phase._tag === 'ReadyToReview' ? 'Ready to review' : phase._tag}</p>
    <details>
      <summary>Task brief</summary>
      <p>${task.direction.value.name} · version ${task.direction.number}</p>
      <p>Responsibility version ${task.responsibility.number}</p>
      ${task.stages.map((stage, index) => html`<p key=${index}>${stage.name} · ${stage.work}</p>`)}
      ${taskRules(task).map((rule, index) => html`<p key=${index}>${rule.name} · ${rule.text}</p>`)}
    </details>
    ${phase._tag === 'Working' ? html`<p>Attempt ${phase.attempt.number}</p>` : null}
    ${result ? html`<p>${result.summary}</p>
      ${result.files.map((file) => html`<${FileResult} key=${file.path} file=${file} />`)}` : null}
    ${phase._tag === 'ReadyToReview' ? html`<p role="status">${blocked ?? 'Waiting for committed command outcomes.'}</p>` : null}
    ${outcomes?.map(({ rule, evidence, _tag }, index) => html`<details key=${index}>
      <summary>${rule.name} · ${_tag}${evidence._tag === 'CommandOutput' ? ' · exit ' + evidence.exit : ''}</summary>
      <${ReviewEvidence} evidence=${evidence} />
    </details>`)}
    ${feedback?._tag === 'Review' ? html`<section aria-label="Review feedback">
      <h4>Review feedback</h4>
      ${feedback.breaks.map(({ rule, evidence }, index) => html`<div key=${index}><p>${rule.name}</p><${ReviewEvidence} evidence=${evidence} /></div>`)}
    </section>` : null}
    ${raised ? html`<section aria-label="Raised task">
      <p>${raised.reason}</p>
      ${raised.evidence.map((evidence) => html`<${ReviewEvidence} evidence=${evidence} />`)}
      ${raised.fix._tag === 'Unassessed' ? null : html`
        <p>${raised.fix.assessment.missed} · ${raised.fix.assessment.why}</p>
        ${raised.fix.assessment.missed === 'MovingTarget' ? html`<p>Follow the app’s directions for a moving target.</p>` : null}
      `}
      ${proposal?.phase._tag === 'WaitingForOwner'
        ? html`<p><a href=${'#' + proposal.key}>Review the fix proposal</a></p>`
        : proposal ? html`<p>Fix proposal · ${proposal.phase._tag}</p>` : null}
      ${submit && takeAsIsEligibility(raised) === 'Allowed' ? html`
        <${ReviewInput} label="Why accept the finished result?" action="Take as is" onSubmit=${(why: string) => choose('takeAsIs', why)} />
      ` : null}
      ${submit ? html`
        <${ReviewInput} label="Why drop this task?" action="Drop task" onSubmit=${(why: string) => choose('drop', why)} />
      ` : null}
      ${failure ? html`<p role="alert">${failure.why}</p>` : null}
    </section>` : null}
    ${phase._tag === 'Done' && phase.accepted._tag === 'Owner' ? html`<p>Taken as is · ${phase.accepted.why}</p>` : null}
    ${phase._tag === 'Dropped' ? html`<p>${phase.why}</p>` : null}
  </article>`
}
