import { Result, Schema } from 'effect'
import {
  DirectionVersion, Part, Rationale, Stage, StagePosition, actorFor, partStages, refuse, roleOf, sameActor,
  senderOf, stagePositions, taskDepth, type Of, type Partition, type Project,
  type ReadPosition, type Refusal, type StoredActor, type Task, type TaskEvent,
} from '../schema/project.ts'

const versionsEqual = Schema.toEquivalence(DirectionVersion)
const stagesEqual = Schema.toEquivalence(Stage)
const invalid = (why: string) => Result.fail(refuse('InvalidInput', Rationale.make(why)))
const stale = () => Result.fail(refuse('Stale', Rationale.make('Read the current task partition and its parts again.')))

export const acceptedDirection = (project: Project, direction: Of<typeof DirectionVersion>, read: Of<typeof ReadPosition>) => {
  if (direction.acceptedIn > read) return undefined
  for (const { phase, basis } of project.proposals.values()) {
    if (phase._tag === 'Accepted' && phase.version.value._tag === 'Direction' && basis._tag === 'Version' &&
        basis.version.acceptedIn === direction.acceptedIn) return undefined
  }
  return [...project.proposals.values()].find(({ phase }) => phase._tag === 'Accepted' &&
    phase.version.value._tag === 'Direction' && versionsEqual({ ...phase.version, value: phase.version.value }, direction))
}

export const directionSlice = (direction: Of<typeof DirectionVersion>, stages: Task['stages']) => {
  const source = direction.value.stages
  const start = source.findIndex((_, index) => stages.every((stage, delta) =>
    source[index + delta] !== undefined && stagesEqual(source[index + delta]!, stage)))
  if (start < 0) return undefined
  const [first, ...rest] = source.slice(start, start + stages.length)
  return first && [first, ...rest] as const
}

export const matchSender = (project: Project, task: Task, actor: StoredActor) => {
  const acting = actorFor(project, actor)
  const sender = senderOf(project, task)
  return acting && sender && sameActor(sender, acting)
}

export const childDraft = (parent: Task, part: Part) => {
  const positions = partStages(parent, part)
  const [first, ...rest] = positions.map((position) => parent.stages[position - 1]!)
  if (!first) return undefined
  return {
    name: part.name, goal: part.goal, role: part.role, reviewer: parent.reviewer,
    direction: parent.direction, facts: parent.facts, stages: [first, ...rest] as const,
    attachments: parent.attachments.flatMap((entry) => {
      const index = positions.indexOf(entry.at)
      return index < 0 ? [] : [{ ...entry, at: StagePosition.make(index + 1) }]
    }),
  }
}

const equalPart = Schema.toEquivalence(Part)
const replaceable = (task: Task) => task.phase._tag === 'Dropped' ||
  task.phase._tag === 'Sent' ||
  (task.phase._tag === 'Raised' && task.phase.retained._tag === 'NoResult')

export const validatePartition = (
  project: Project, task: Task, partition: Partition, read: Of<typeof ReadPosition>,
  move: Extract<TaskEvent, { move: 'split' | 'redistribute' | 'joinParts' | 'dropStage' }>['move'],
): Result.Result<Partition, Refusal> => {
  const depth = taskDepth(project, task)
  if (depth === 4 || depth === 'Invalid') return invalid('A task tree has at most four levels.')
  const prior = project.tasks.get(task.key)?.phase
  const old = prior?._tag === 'Split' ? prior.partition.parts : []
  const expected = stagePositions(task)
  const actual = partition.parts.flatMap((part) => partStages(task, part))
  if (actual.length !== expected.length || actual.some((stage, index) => stage !== expected[index]))
    return invalid('Cover the current stages exactly once in their original order.')
  if (move === 'joinParts' && (partition.parts.length >= old.length || partition.parts.some(({ range }) =>
    !old.some((part) => part.range.first === range.first) || !old.some((part) => part.range.last === range.last))))
    return invalid('Join adjacent parts without cutting through an existing part.')
  if (move === 'redistribute' && (partition.parts.length !== old.length || partition.parts.every(({ range }, index) =>
    range.first === old[index]?.range.first && range.last === old[index]?.range.last)))
    return invalid('Redistribute moves stage boundaries while keeping the part count.')
  if (old.length === partition.parts.length && old.every((part, index) => equalPart(part, partition.parts[index]!)))
    return invalid('Change the current partition.')
  const earlier = new Set<Task['key']>()
  for (const part of partition.parts) {
    const positions = partStages(task, part)
    if (part.task === task.key || earlier.has(part.task) || positions[0] !== part.range.first || positions.at(-1) !== part.range.last)
      return invalid('Give each part a distinct task key and a nonempty stage range.')
    const role = roleOf(project, part.role)
    if (!role || role.responsibility.acceptedIn > read) return stale()
    if (part.dependency._tag === 'Parallel' &&
        (new Set(part.dependency.after).size !== part.dependency.after.length ||
          part.dependency.after.some((key) => !earlier.has(key))))
      return invalid('Parallel dependencies must name earlier distinct parts.')
    earlier.add(part.task)
    const recorded = project.tasks.get(part.task)
    if (!recorded) continue
    const previous = old.find(({ task }) => task === part.task)
    if (!previous || !equalPart(previous, part) || recorded.phase._tag === 'Dropped')
      return invalid('Use a fresh key for a changed part or for work replacing a dropped task.')
    if (recorded.changedIn > read) return stale()
  }
  for (const [index, part] of old.entries()) {
    const record = project.tasks.get(part.task)
    if (!record || record.changedIn > read) return stale()
    if (!replaceable(record) && old.slice(0, index + 1).some((prior, before) =>
      !partition.parts[before] || !equalPart(prior, partition.parts[before]!)))
      return invalid('Keep active and completed parts with their original predecessors.')
  }
  return Result.succeed(partition)
}
