import { html } from 'htm/preact'
import { useEffect, useState } from 'preact/hooks'
import { Result } from 'effect'
import { ownerProposals } from '../../../core/derived/project/review.ts'
import { questionAddressText } from '../../words/project.ts'
import { questionsFor } from '../../../core/derived/project/next-step.ts'
import { Rationale, type ApprovedFiles, approvedProposals, boundHostSession, type Of, type Project, type Refusal, type Submission, type TaskKey } from '../../../core/schema/project.ts'
import { ProposalCard } from './project-proposal.ts'
import { RoleCard } from './project-roles.ts'
import { QuestionCard } from './project-question.ts'
import { TaskPanel } from './task.ts'
import type { ProposalReply } from './project-api.ts'

function renderOnboarding({ project, submit, markerFiles, commandBlock }: {
  readonly project: Project
  readonly submit: (submission: Submission) => Promise<ProposalReply>
  readonly markerFiles: () => Promise<Of<typeof ApprovedFiles>>
  readonly commandBlock?: (key: Of<typeof TaskKey>) => Promise<Refusal['why'] | null>
}): ReturnType<typeof html> {
  return html`<section aria-label="Onboarding">
    ${ownerProposals(project).map((proposal) => html`<${ProposalCard} key=${proposal.key} proposal=${proposal}
      read=${project.read} submit=${submit} />`)}
    ${[...project.proposals.values()].filter(({ phase }) => phase._tag === 'Accepted').map((proposal) =>
      html`<${ProposalCard} key=${proposal.key} proposal=${proposal} read=${project.read} submit=${submit} />`)}
    <${RoleCard} project=${project} submit=${submit} />
    ${questionsFor(project, project.owner).map(({ question, owner }) => html`<${QuestionCard} key=${questionAddressText({ owner, key: question.key })}
      question=${question} owner=${owner} read=${project.read} submit=${async (submission: Submission) => {
        const result = await submit(submission)
        return Result.isFailure(result) ? result.failure : null
      }} />`)}
    <${ActivationPanel} project=${project} submit=${submit} markerFiles=${markerFiles} />
    ${[...project.tasks.values()].map((task) => html`<${TaskPanel} key=${task.key} task=${task} commandBlock=${commandBlock} />`)}
  </section>`
}

export { renderOnboarding as OnboardingView }

export function ActivationPanel({ project, submit, markerFiles }: {
  readonly project: Project
  readonly submit: (submission: Submission) => Promise<ProposalReply>
  readonly markerFiles: () => Promise<Of<typeof ApprovedFiles>>
}): ReturnType<typeof html> {
  const [files, setFiles] = useState<Of<typeof ApprovedFiles> | null>(null)
  const [failure, setFailure] = useState<Refusal['why'] | null>(null)
  const [busy, setBusy] = useState(false)
  const { activation, read } = project
  const binding = boundHostSession(project)
  useEffect(() => setFiles(null), [activation._tag])
  const send = async (submission: Extract<Submission, { line: 'Activation' }>) => {
    setBusy(true)
    try {
      const response = await submit(submission)
      setFailure(Result.isFailure(response) ? response.failure.why : null)
    } finally { setBusy(false) }
  }
  return html`<section aria-label="Activation" class="review-stage">
    ${activation._tag === 'Onboarding' && approvedProposals(project)
      ? files ? html`<ul>${files.map(({ path }) => html`<li key=${path}>${path}</li>`)}</ul>
        <button class="btn primary" disabled=${busy} onClick=${() =>
          void send({ read, line: 'Activation', move: 'next', input: { files } })}>Approve and activate</button>`
        : html`<button class="btn" disabled=${busy} onClick=${async () => {
          setBusy(true)
          try {
            setFiles(await markerFiles())
            setFailure(null)
          } catch {
            setFailure(Rationale.make('Could not read the activation files.'))
          } finally { setBusy(false) }
        }}>Review activation files</button>`
      : activation._tag === 'Onboarding' ? html`<p>Accept the onboarding proposals before activation.</p>`
      : activation._tag === 'Activating' ? html`<p>Waiting for the host to acknowledge activation.</p>`
      : activation._tag === 'RollingBack' ? html`<p>Restoring approved files.</p>`
      : activation.work._tag === 'NotStarted' && binding ? html`<button class="btn primary" disabled=${busy} onClick=${() =>
        void send({ read, line: 'Activation', move: 'start', input: {} })}>Start work</button>`
      : activation.work._tag === 'NotStarted' ? html`<p>Waiting for a live host session.</p>`
      : html`<p>Work is open.</p>`}
    ${failure ? html`<p role="alert">${failure}</p>` : null}
  </section>`
}
