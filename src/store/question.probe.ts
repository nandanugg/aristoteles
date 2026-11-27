import { Effect, Schema } from 'effect'
import { projectQuestionCommand } from '../../adapters/cli/commands/project.ts'
import { projectSubmission } from '../../adapters/web/project.ts'
import { Authority, type AuthenticatedActor } from '../../core/actions/project.ts'
import { QuestionKey, Refusal, type LiveSession, type Of, type ReadPosition, type Submission } from '../../core/schema/project.ts'
import type { Journal } from '../../core/services/project.ts'
import { session } from './project.probe.ts'

export const ownerAuthority: AuthenticatedActor = { _tag: 'Human', actor: { _tag: 'Human' } }
export const staffAuthorityOf = (live: LiveSession = session): AuthenticatedActor => ({ _tag: 'Staff', session: live })
export const questionKey = QuestionKey.make('question:example')
export const shortAnswer = { _tag: 'ShortAnswer' } as const
export const answerYaml = (text: string) => Bun.YAML.stringify({ _tag: 'ShortAnswer', text })
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
