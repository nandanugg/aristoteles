import { Result, Schema } from 'effect'
import { Refusal as ProjectRefusal, Rationale, refuse as refuseProject, type Project, Submission } from '../../../core/schema/project.ts'
import { receiveProjectPayload, replaceProjectSnapshot, type PageProject } from './project-state.ts'

export type ProposalReply = Result.Result<Project, ProjectRefusal>

const encodeSubmission = Schema.encodeSync(Submission)

export const postProjectSubmission = async (
  endpoint: URL, snapshot: URL, page: PageProject, submission: Submission,
): Promise<ProposalReply> => {
  const failed = () => Result.fail(refuseProject('Unavailable', Rationale.make('Could not read the project’s committed response.')))
  try {
    const response = await fetch(endpoint, {
      method: 'POST', body: JSON.stringify(encodeSubmission(submission)), headers: { 'content-type': 'application/json' },
    })
    const body: unknown = await response.json()
    if (!response.ok) {
      const refusal = Schema.decodeUnknownResult(ProjectRefusal, { onExcessProperty: 'error' })(body)
      return Result.isSuccess(refusal) ? Result.fail(refusal.success) : failed()
    }
    const applied = receiveProjectPayload(page, body)
    if (Result.isSuccess(applied) && applied.success) return Result.succeed(applied.success)
    const current = await fetch(snapshot)
    return current.ok ? replaceProjectSnapshot(page, await current.json()) : failed()
  } catch {
    return failed()
  }
}
