import { Effect, Schema } from 'effect'
import { projectQuestionCommand } from '../../adapters/cli/commands/acts.ts'
import { projectSubmission } from '../../adapters/web/project.ts'
import { Authority, type AuthenticatedActor } from '../../core/actions/project.ts'
import { QuestionId, Refusal, type LiveSession, type Of, type ReadPosition, type Submission } from '../../core/schema/project.ts'
import type { Journal } from '../../core/services/project.ts'
import { owner, session } from './project.probe.ts'

export const ownerAuthority: AuthenticatedActor = { _tag: 'Human', actor: { _tag: 'Human', id: owner.id } }
export const staffAuthorityOf = (live: LiveSession = session): AuthenticatedActor => ({ _tag: 'Staff', session: live })
export const questionId = QuestionId.make('question:example')
export const textForm = { _tag: 'Single', prompt: { text: 'What did you decide?', placeholder: null } } as const
export const answerYaml = (text: string) => Bun.YAML.stringify({ _tag: 'Single', text })
export const cliQuestion = (
  journal: Journal, actor: AuthenticatedActor, command: 'question' | 'answer',
  target: string, read: Of<typeof ReadPosition>, yaml: string,
) => projectQuestionCommand(journal, command, target, read, yaml).pipe(
  Effect.provideService(Authority, { actor: Effect.succeed(actor) }),
)
export const pageQuestion = (journal: Journal, actor: AuthenticatedActor, submission: Submission) =>
  projectSubmission(journal, new Request('http://localhost/project/submissions', {
    method: 'POST', body: JSON.stringify(submission), headers: { 'content-type': 'application/json' },
  })).pipe(Effect.provideService(Authority, { actor: Effect.succeed(actor) }))
export const readRefusal = Schema.decodeUnknownSync(Refusal, { onExcessProperty: 'error' })
