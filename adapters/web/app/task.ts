import { useEffect, useState } from 'preact/hooks'
import { html } from 'htm/preact'
import { taskRules, type Refusal, type Task, type TaskId, type Of, type WholeFile } from '../../../core/schema/project.ts'

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

export function TaskPanel({ task, commandBlock }: {
  readonly task: Task
  readonly commandBlock?: (id: Of<typeof TaskId>) => Promise<Refusal['why'] | null>
}) {
  const { phase } = task
  const [blocked, setBlocked] = useState<Refusal['why'] | null>(null)
  useEffect(() => {
    setBlocked(null)
    if (!commandBlock || phase._tag !== 'ReadyToReview') return
    let current = true
    const update = () => { void commandBlock(task.id).then((why) => { if (current) setBlocked(why) }, () => {}) }
    update()
    const timer = setInterval(update, 1000)
    return () => { current = false; clearInterval(timer) }
  }, [task.id, task.lastChange, phase._tag, commandBlock])
  const result = phase._tag === 'ReadyToReview' || phase._tag === 'Reviewing' || phase._tag === 'Done' ? phase.result : null
  const outcomes = phase._tag === 'Reviewing' || phase._tag === 'Done' ? phase.outcomes : null
  return html`<article aria-label=${task.name}>
    <h3>${task.name}</h3><p>${task.goal}</p>
    <p>${task.role.name} · ${phase._tag === 'ReadyToReview' ? 'Ready to review' : phase._tag}</p>
    <details>
      <summary>Task brief</summary>
      <p>${task.direction.value.name} · version ${task.direction.number}</p>
      ${task.stages.map((stage) => html`<p key=${stage.id}>${stage.name} · ${stage.work}</p>`)}
      ${taskRules(task).map((rule) => html`<p key=${rule.id}>${rule.name} · ${rule.text}</p>`)}
    </details>
    ${phase._tag === 'Working' ? html`<p>Attempt ${phase.attempt.number}</p>` : null}
    ${result ? html`<p>${result.summary}</p>
      ${result.files.map((file) => html`<${FileResult} key=${file.path} file=${file} />`)}` : null}
    ${phase._tag === 'ReadyToReview' ? html`<p role="status">${blocked ?? 'Waiting for committed command outcomes.'}</p>` : null}
    ${outcomes?.map(({ rule, evidence, _tag }) => html`<details key=${rule.id}>
      <summary>${rule.name} · ${_tag} · exit ${evidence.exit}</summary>
      <pre>${evidence.stdout}</pre>${evidence.stderr ? html`<pre>${evidence.stderr}</pre>` : null}
    </details>`)}
    ${phase._tag === 'Raised' ? html`<p>${phase.reason}</p>` : null}
  </article>`
}
