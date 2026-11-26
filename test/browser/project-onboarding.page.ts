import { Result } from 'effect'
import { h, render } from 'preact'
import { postProjectSubmission } from '../../adapters/web/app/api.ts'
import { OnboardingView } from '../../adapters/web/app/onboarding.ts'
import { openPageProject, receiveProjectPayload } from '../../adapters/web/app/project-state.ts'
import type { Projection, Submission } from '../../core/schema/project.ts'
import { readPosition } from '../../core/state/project.ts'

const url = (path: string) => new URL(path, location.origin)
const root = document.querySelector('main')!
const send = (input: Submission) => postProjectSubmission(url('/submissions'), url('/snapshot'), page, input)
const draw = (project: Projection) => render(project ? h(OnboardingView, { project, submit: send, markerFiles: async () => (await fetch(url('/activation-files'))).json() }) : null, root)
const snapshot = await fetch(url('/snapshot'))
const page = Result.getOrThrow(openPageProject(await snapshot.json(), draw))
draw(page.current())

let polling = false
setInterval(async () => {
  if (polling) return
  polling = true
  try {
    const response = await fetch(url('/events?after=' + readPosition(page.current())))
    if (response.ok) receiveProjectPayload(page, await response.json())
  } finally {
    polling = false
  }
}, 25)
