import { Schema } from 'effect'
import { acceptedDirections } from '../../core/derived/project/next-step.ts'
import { DirectionVersion, Introduction, roleOf, staffByKey, taskRole, taskRules, TaskBriefText, type Evidence, type LiveSession, type Of, type Project, type Question, type QuestionEvent, type QuestionText, type ReadPosition, type Refusal, type Task } from '../../core/schema/project.ts'

const taskEvidenceWords = (evidence: Of<typeof Evidence>) => evidence._tag === 'Quote'
  ? `${evidence.file}:${evidence.lines.first}–${evidence.lines.last} ${evidence.text}`
  : `${evidence.command.text} (exit ${evidence.exit}) ${evidence.stdout}${evidence.stderr}`

export const projectTaskWords = (task: Task, blocked: Refusal['why'] | null = null): Of<typeof TaskBriefText> => {
  const { phase } = task
  return TaskBriefText.make([
    `Task ${task.key}: ${task.name}`,
    `Goal: ${task.goal}`,
    `Direction: ${task.direction.value.name} (version ${task.direction.number})`,
    `Role: ${taskRole(task).name} (responsibility version ${taskRole(task).responsibility.number})`,
    ...taskRole(task).responsibility.value.duties,
    ...task.stages.map((stage) => `${stage.name}: ${stage.work}`),
    ...taskRules(task).map((rule) => `${rule.name}: ${rule.text}`),
    `Phase: ${phase._tag}`,
    ...(phase._tag === 'Working' ? [`Attempt ${phase.attempt.number}`] : []),
    ...((phase._tag === 'Working' || phase._tag === 'Sent') ? (() => {
      const feedback = phase._tag === 'Working' ? phase.attempt.feedback : phase.feedback
      return feedback._tag === 'Review' ? feedback.breaks.map(({ rule, evidence }) =>
        `Review feedback for ${rule.name}: ${taskEvidenceWords(evidence)}`) : []
    })() : []),
    ...(phase._tag === 'Raised' ? [`Reason: ${phase.reason}`, taskEvidenceWords(phase.evidence)] : []),
    ...(phase._tag === 'ReadyToReview' ? [blocked ?? 'Waiting for the committed command outcomes.'] : []),
    ...(phase._tag === 'Reviewing' || phase._tag === 'Done' ? phase.outcomes.map((outcome) =>
      `${outcome.rule.name}: ${outcome._tag} · ${taskEvidenceWords(outcome.evidence)}`) : []),
  ].join('\n'))
}

export const questionAddressText = ({ owner, key }: Pick<QuestionEvent, 'owner' | 'key'>) =>
  `${owner._tag === 'Project' ? 'project' : owner.key}/${key}` as const

export const projectQuestionWords = (
  { question, owner }: { readonly question: Question; readonly owner: QuestionEvent['owner'] },
  read: Of<typeof ReadPosition>,
): readonly [Of<typeof QuestionText>, `work answer "$ARISTOTELES_TOKEN" ${ReturnType<typeof questionAddressText>} --on=${Of<typeof ReadPosition>} --file=answer.yaml`] =>
  [question.text, `work answer "$ARISTOTELES_TOKEN" ${questionAddressText({ owner, key: question.key })} --on=${read} --file=answer.yaml`]

const encodeDirection = Schema.encodeSync(DirectionVersion)

export const projectIntroductionWords = (
  project: Project, session: LiveSession, read: Of<typeof ReadPosition>,
): Of<typeof Introduction> => {
  const staff = staffByKey(project, session.staff.key) ?? session.staff
  const roles = staff.roles.flatMap((assigned) => {
    const role = roleOf(project, assigned.key)
    if (!role) return []
    const { summary, introduction, duties } = role.responsibility.value
    return [`Role ${role.name}`, summary, introduction, ...duties.map((duty) => `- ${duty}`)]
  })
  const directions = acceptedDirections(project)
  return Introduction.make([
    `Session introduction for ${session.staff.name}`,
    ...roles,
    ...(directions.length ? directions.flatMap((direction) => [
      `Accepted direction ${direction.value.name} (version ${direction.number})`,
      JSON.stringify(encodeDirection(direction), null, 2),
    ]) : ['No accepted directions yet.']),
    `Continue with work wait <token> --on=${read}`,
  ].join('\n'))
}
