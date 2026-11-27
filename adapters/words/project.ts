import { Schema } from 'effect'
import { acceptedDirections } from '../../core/derived/project/next-step.ts'
import { DirectionVersion, Introduction, Markdown, activeStages, pendingFix, roleOf, staffByKey, taskAdmission, taskMembership, taskRole, taskRules, TaskBriefText, type Evidence, type LiveSession, type Of, type Project, type Question, type QuestionEvent, type ReadPosition, type Refusal, type ReviewFacts, type StoredEvent, type Task } from '../../core/schema/project.ts'

const taskEvidenceWords = (evidence: Of<typeof Evidence>) => evidence._tag === 'Quote'
  ? `${evidence.file}:${evidence.lines.first}–${evidence.lines.last} ${evidence.text}`
  : `${evidence.command.text} (exit ${evidence.exit}) ${evidence.stdout}${evidence.stderr}`

export const projectTaskWords = (project: Project, task: Task, blocked: Refusal['why'] | null = null): Of<typeof TaskBriefText> => {
  const { phase } = task
  const proposal = phase._tag === 'Raised' ? pendingFix(project, task.key) : undefined
  return TaskBriefText.make([
    `Task ${task.key}: ${task.name}`,
    `Goal: ${task.goal}`,
    `Direction: ${task.direction.value.name} (version ${task.direction.number})`,
    `Role: ${roleOf(project, taskRole(task))?.name ?? taskRole(task)} (responsibility version ${task.responsibility.number})`,
    ...task.responsibility.value.duties,
    `Reviewer ${roleOf(project, task.reviewer)?.name ?? task.reviewer} (responsibility version ${task.reviewerResponsibility.number})`,
    ...task.reviewerResponsibility.value.duties,
    ...activeStages(task).map((stage) => `${stage.name}: ${stage.work}`),
    ...task.attachments.filter(({ at }) => !task.omitted.includes(at)).map(({ at, direction, stage }) =>
      `Stage ${at} also follows ${direction.value.name}: ${direction.value.stages[stage - 1]?.work}`),
    ...taskRules(task).map((rule) => `${rule.name}: ${rule.text}`),
    `Phase: ${phase._tag}`,
    ...(task.parent._tag === 'Child' ? [`Parent: ${task.parent.parent}`] : []),
    ...(taskMembership(project, task) === 'Replaced' ? ['This part was replaced.'] : []),
    ...(phase._tag === 'Sent' && taskAdmission(project, task) === 'Predecessor' ? ['Waiting for the preceding part.'] : []),
    ...(phase._tag === 'Sent' && taskAdmission(project, task) === 'Parallel' ? ['Waiting for a prepared worktree.'] : []),
    ...(phase._tag === 'Split' ? [phase.partition.why, phase.partition.review,
      ...phase.partition.parts.map((part) =>
        `${part.name} (${part.task}) · stages ${part.range.first}–${part.range.last} · ${part.dependency._tag} · ${part.why}`),
    ] : []),
    ...(phase._tag === 'Working' ? [`Attempt ${phase.attempt.number}`] : []),
    ...((phase._tag === 'Working' || phase._tag === 'Sent') ? (() => {
      const feedback = phase._tag === 'Working' ? phase.attempt.feedback : phase.feedback
      return feedback._tag === 'Review' ? feedback.breaks.map(({ rule, evidence }) =>
        `Review feedback for ${rule.name}: ${taskEvidenceWords(evidence)}`) : []
    })() : []),
    ...(phase._tag === 'Raised' ? [
      `Reason: ${phase.reason}`, ...(phase.origin._tag === 'Brief' ? [phase.origin.why] : phase.evidence.map(taskEvidenceWords)),
      ...(phase.retained._tag === 'Retained' ? [`Finished result: ${phase.retained.result.summary}`] : []),
      ...(phase.fix._tag !== 'Unassessed' ? [
        `Assessment: ${phase.fix.assessment.missed} · ${phase.fix.assessment.why}`,
        ...(phase.fix.assessment.missed === 'MovingTarget' ? ['Follow the app’s directions for a moving target.'] : []),
        ...(proposal ? [
          `Fix proposal ${proposal.key} · ${proposal.phase._tag}`,
        ] : []),
      ] : []),
    ] : []),
    ...(phase._tag === 'Done' && phase.accepted._tag === 'Owner' ? [`Taken as is: ${phase.accepted.why}`] : []),
    ...(phase._tag === 'Dropped' ? [`Dropped: ${phase.why}`] : []),
    ...(phase._tag === 'ReadyToReview' ? [blocked ?? 'Waiting for the committed command outcomes.'] : []),
    ...(phase._tag === 'Reviewing' || phase._tag === 'Done' ? phase.outcomes.map((outcome) =>
      `${outcome.rule.name}: ${outcome._tag} · ${taskEvidenceWords(outcome.evidence)}`) : []),
  ].join('\n'))
}

export const questionAddressText = ({ owner, key }: Pick<QuestionEvent, 'owner' | 'key'>) =>
  `${owner._tag === 'Project' ? 'project' : owner.key}/${key}` as const

const questionAnswerWords = (expects: Question['expects']) => {
  const kind = `Answer kind ${expects._tag}`
  switch (expects._tag) {
    case 'ShortAnswer': return `${kind} with one line of text.`
    case 'Markdown': return `${kind} with Markdown text.`
    case 'OneChoice':
    case 'ManyChoices': return `${kind} with zero-based picks. Options ${JSON.stringify(expects.options)}`
    case 'Matrix': return `${kind} with one zero-based column per row. Rows ${JSON.stringify(expects.rows)}. Columns ${JSON.stringify(expects.columns)}`
  }
}

export const projectQuestionWords = (
  { question, owner }: { readonly question: Question; readonly owner: QuestionEvent['owner'] },
  read: Of<typeof ReadPosition>,
): readonly [Of<typeof Markdown>, Of<typeof Markdown>, `work answer "$ARISTOTELES_TOKEN" ${ReturnType<typeof questionAddressText>} --on=${Of<typeof ReadPosition>} --file=answer.yaml`] =>
  [question.text, Markdown.make(questionAnswerWords(question.expects)), `work answer "$ARISTOTELES_TOKEN" ${questionAddressText({ owner, key: question.key })} --on=${read} --file=answer.yaml`]

const encodeDirection = Schema.encodeSync(DirectionVersion)

export const projectIntroductionWords = (
  project: Project, session: LiveSession, read: Of<typeof ReadPosition>,
): Of<typeof Introduction> => {
  const staff = staffByKey(project, session.staff.key) ?? session.staff
  const roles = staff.roles.flatMap((assigned) => {
    const role = roleOf(project, assigned)
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

const reviewFactsWords = (facts: ReviewFacts) => [
  ...facts.outcomes.map(({ rule, _tag, evidence }) => `${rule.name} · ${_tag} · ${taskEvidenceWords(evidence)}`),
  ...facts.findings.map(({ text, evidence }) => `${text} · ${taskEvidenceWords(evidence)}`),
]

export const sessionUpdateWords = (project: Project, session: LiveSession, event: StoredEvent): Of<typeof Markdown> => {
  const prefix = `Event ${event.number}`
  const words = (() => {
    switch (event.line) {
      case 'Project': {
        if (event.move === 'apply') {
          const phase = project.proposals.get(event.input.proposal)?.phase
          if (phase?._tag === 'Accepted') {
            const { value, number } = phase.version
            if (value._tag === 'Responsibility')
              return `Applied responsibility for ${roleOf(project, value.role)?.name ?? value.role} (version ${number})\n${value.summary}\n${value.introduction}\n${value.duties.map((duty) => '- ' + duty).join('\n')}`
            if (value._tag === 'Staffing') {
              const staff = value.staff.get(session.staff.key)
              return [`Applied staffing (version ${number})`, ...(staff
                ? [`${staff.name} · ${staff.roles.join(', ')} · ${staff.model}`, staff.why] : [])].join('\n')
            }
          }
        }
        if (event.from === 'Activating' && event.move === 'next') return 'Project is active.'
        return 'Project work started.'
      }
      case 'Session': return `Session ${event.key} · ${event.from === 'Paused' || event.from === 'Live' ? event.input.observed : 'Live'}.`
      case 'Question': {
        const address = questionAddressText(event)
        if (event.from === null)
          return `Question ${address}\n${event.input.text}\n${questionAnswerWords(event.input.expects)}`
        return `Answer to ${address}\n${JSON.stringify(event.input.answer, null, 2)}`
      }
      case 'Proposal': {
        if (event.from === 'WaitingForOwner' && event.move === 'accept') {
          const phase = project.proposals.get(event.key)?.phase
          if (phase?._tag === 'Accepted') {
            const { value, number } = phase.version
            if (value._tag === 'Direction')
              return `Accepted direction ${value.name} (version ${number})\n${JSON.stringify(value, null, 2)}`
          }
        }
        if (event.move === 'sendBack')
          return `Proposal ${event.key} returned\n${event.from === 'Reviewing' ? reviewFactsWords(event.input.facts).join('\n') : event.input.why}`
        if (event.from === null && event.move === 'submit') return `Fix proposal ${event.key} submitted for task ${event.input.subject.task}.`
        if (event.move === 'accept') return `Proposal ${event.key} accepted.`
        if (event.move === 'release') return `Proposal ${event.key} returned to the review queue.`
        if (event.move === 'remove') return `Proposal ${event.key} removed.`
        return `Proposal ${event.key} assigned for review.`
      }
      case 'Task': {
        if (event.move === 'split' || event.move === 'joinParts' || event.move === 'redistribute')
          return `Task ${event.key} partitioned · ${event.move === 'split' ? event.input.partition.why : event.input.why}`
        if (event.move === 'dropStage') return `Task ${event.key} dropped stage ${event.input.stage}\n${event.input.evidence.map(taskEvidenceWords).join('\n')}`
        if (event.from === null) return event.input._tag === 'Child'
          ? `Task ${event.key} sent as part of ${event.input.parent}.`
          : `Task ${event.key} sent · ${event.input.name}\n${event.input.goal}`
        if (event.from === 'ReadyToReview') return [`Task ${event.key} ready for review`,
          ...event.input.outcomes.map(({ rule, _tag, evidence }) => `${rule.name} · ${_tag} · ${taskEvidenceWords(evidence)}`),
        ].join('\n')
        if (event.from === 'Raised') {
          switch (event.move) {
            case 'back': return `Task ${event.key} resent with a corrected brief · ${event.input.why}`
            case 'assess': return `Task ${event.key} assessed · ${event.input.missed} · ${event.input.why}` +
              (event.input.missed === 'MovingTarget' ? '\nFollow the app’s directions for a moving target.' : '')
            case 'tryAgain': return `Task ${event.key} sent for its one automatic retry.`
            case 'takeAsIs': return `Task ${event.key} taken as is · ${event.input.why}`
            case 'drop': return `Task ${event.key} dropped · ${event.input.why}`
            case 'applyFix': return `Task ${event.key} sent under accepted fix ${event.input.proposal}.`
          }
        }
        if (event.move === 'release') return `Task ${event.key} returned to the review queue.`
        if (event.from === 'Reviewing' && event.move !== 'assign') {
          const changes = event.move === 'back' ? 'returned' : event.move === 'raise' ? 'raised · ' + event.input.reason : 'accepted'
          return [`Task ${event.key} ${changes}`, ...reviewFactsWords(event.input.facts)].join('\n')
        }
        if (event.move === 'raise') return [`Task ${event.key} raised · ${event.input.reason}`,
          ...(event.from === 'Sent' ? [event.input.why] : event.input.evidence.map(taskEvidenceWords))].join('\n')
        if (event.move === 'restart') return `Task ${event.key} sent for a fresh attempt.`
        return `Task ${event.key} assigned for review.`
      }
    }
  })()
  return Markdown.make(`${prefix} · ${words}`)
}
