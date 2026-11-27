import { Schema } from 'effect'
import { DirectionVersion } from './direction.ts'
import type { Project } from './records.ts'
import { staffOf } from './staff.ts'
import type { Task } from './task.ts'
import { Goal, Name, Rationale, ReadPosition, RoleKey, StaffKey, StagePosition, TaskKey, type Of } from './values.ts'

export const TaskParent = Schema.Union([
  Schema.TaggedStruct('Root', {}),
  Schema.TaggedStruct('Child', { parent: TaskKey }),
])
export const StageRange = Schema.Struct({ first: StagePosition, last: StagePosition })
  .check(Schema.makeFilter(({ first, last }) => first <= last))
export const StageAttachment = Schema.Struct({
  at: StagePosition, direction: DirectionVersion, stage: StagePosition,
})
export const StageDependency = Schema.Union([
  Schema.TaggedStruct('Serial', {}),
  Schema.TaggedStruct('Parallel', { after: Schema.Array(TaskKey) }),
])
export const Part = Schema.Struct({
  task: TaskKey, name: Name, goal: Goal, role: RoleKey,
  range: StageRange, dependency: StageDependency, why: Rationale,
})
export const Partition = Schema.Struct({
  why: Rationale, review: Rationale, parts: Schema.Array(Part).check(Schema.isMinLength(2)),
})
export type Part = Of<typeof Part>
export type Partition = Of<typeof Partition>

export const taskDepth = (project: Project, task: Task): 1 | 2 | 3 | 4 | 'Invalid' => {
  let node = task
  const seen = new Set([node.key])
  const levels = [1, 2, 3, 4] as const
  for (const depth of levels) {
    if (node.parent._tag === 'Root') return depth
    const parent = project.tasks.get(node.parent.parent)
    if (!parent || seen.has(parent.key)) return 'Invalid'
    seen.add(parent.key)
    node = parent
  }
  return 'Invalid'
}

export const currentPart = (project: Project, key: Of<typeof TaskKey>, parent: Of<typeof TaskKey>) => {
  const phase = project.tasks.get(parent)?.phase
  return phase?._tag === 'Split' ? phase.partition.parts.find((part) => part.task === key) : undefined
}

export const taskMembership = (project: Project, task: Task): 'Current' | 'Replaced' => {
  let node = task
  const seen = new Set([node.key])
  while (node.parent._tag === 'Child') {
    const key = node.parent.parent
    const parent = project.tasks.get(key)
    if (!parent || seen.has(key) || !currentPart(project, node.key, key)) return 'Replaced'
    seen.add(key)
    node = parent
  }
  return 'Current'
}

export const senderOf = (project: Project, task: Task):
  { readonly _tag: 'Human' } | { readonly _tag: 'Staff'; readonly key: Of<typeof StaffKey> } | undefined => {
  if (task.parent._tag === 'Root') return { _tag: 'Human' }
  const parent = project.tasks.get(task.parent.parent)
  const sender = parent && staffOf(project, parent.role)
  return sender && { _tag: 'Staff', key: sender.key }
}

export const stagePositions = (task: Pick<Task, 'stages' | 'omitted'>) =>
  task.stages.map((_, index) => StagePosition.make(index + 1)).filter((position) => !task.omitted.includes(position))
export const activeStages = (task: Pick<Task, 'stages' | 'omitted'>) =>
  stagePositions(task).map((position) => task.stages[position - 1]!)
export const partStages = (task: Pick<Task, 'stages' | 'omitted'>, { range }: Part) =>
  stagePositions(task).filter((position) => position >= range.first && position <= range.last)

export const taskAdmission = (project: Project, task: Task, read: Of<typeof ReadPosition> = project.read): 'Allowed' | 'NeedsSplit' | 'Predecessor' | 'Parallel' | 'Replaced' => {
  if (taskMembership(project, task) !== 'Current') return 'Replaced'
  if (activeStages(task).some(({ role }) => role !== task.role)) return 'NeedsSplit'
  if (task.parent._tag === 'Root') return 'Allowed'
  const parent = project.tasks.get(task.parent.parent)
  if (parent?.phase._tag !== 'Split') return 'Replaced'
  if (parent.changedIn > read) return 'Predecessor'
  for (const part of parent.phase.partition.parts) {
    if (part.task === task.key) return part.dependency._tag === 'Parallel' ? 'Parallel' : 'Allowed'
    const prior = project.tasks.get(part.task)
    if (prior?.phase._tag !== 'Done' || prior.changedIn > read) return 'Predecessor'
  }
  return 'Replaced'
}
