import { taskRole, taskRules, TaskBriefText, type Evidence, type Of, type Question, type QuestionText, type ReadPosition, type Refusal, type Task } from '../../core/schema/project.ts'

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

export const projectQuestionWords = (
  { key, text }: Of<typeof Question>, read: Of<typeof ReadPosition>,
): readonly [Of<typeof QuestionText>, `work answer "$ARISTOTELES_TOKEN" ${Of<typeof Question>['key']} --on=${Of<typeof ReadPosition>} --file=answer.yaml`] =>
  [text, `work answer "$ARISTOTELES_TOKEN" ${key} --on=${read} --file=answer.yaml`]
