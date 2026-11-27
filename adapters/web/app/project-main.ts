import { Result, Schema } from 'effect'
import { h, render } from 'preact'
import { ApprovedFiles, Rationale, type Of, type Projection, type Submission, type TaskKey } from '../../../core/schema/project.ts'
import { readPosition } from '../../../core/state/project.ts'
import { postProjectSubmission } from './project-api.ts'
import { OnboardingView } from './project-onboarding.ts'
import { openPageProject, receiveProjectPayload, replaceProjectSnapshot } from './project-state.ts'

const url = (path: string) => new URL('/api/project/' + path, location.origin)
const root = document.querySelector('main')!
const status = document.querySelector('[role="status"]')!
const snapshot = url('snapshot')
const response = await fetch(snapshot)
if (!response.ok) {
  status.textContent = 'The project journal could not be opened.'
} else {
  const initial: unknown = await response.json()
  const submit = (input: Submission) => postProjectSubmission(url('submissions'), snapshot, page, input)
  const commandBlock = async (key: Of<typeof TaskKey>) => {
    const endpoint = url('command-status')
    endpoint.searchParams.set('task', key)
    const reply = await fetch(endpoint)
    return reply.ok ? Schema.decodeUnknownSync(Schema.NullOr(Rationale))(await reply.json()) : null
  }
  const draw = (project: Projection) => {
    root.setAttribute('data-read', String(project?.read ?? 0))
    status.textContent = project ? '' : 'Open the project with work onboard open.'
    render(project ? h(OnboardingView, {
      project, submit, commandBlock,
      markerFiles: async () => Schema.decodeUnknownSync(ApprovedFiles, { onExcessProperty: 'error' })(
        await (await fetch(url('activation-files'))).json(),
      ),
    }) : null, root)
  }
  const page = Result.getOrThrow(openPageProject(initial, draw))
  draw(page.current())
  const catchUp = async () => {
    try {
      const changes = url('events')
      changes.searchParams.set('after', String(readPosition(page.current())))
      const update = await fetch(changes)
      if (!update.ok || Result.isFailure(receiveProjectPayload(page, await update.json()))) {
        const fresh = await fetch(snapshot)
        if (!fresh.ok || Result.isFailure(replaceProjectSnapshot(page, await fresh.json()))) throw new Error('Project unavailable')
      }
      status.textContent = ''
    } catch {
      status.textContent = 'Project connection unavailable. Reconnecting…'
    }
    setTimeout(catchUp, 50)
  }
  setTimeout(catchUp, 50)
}
