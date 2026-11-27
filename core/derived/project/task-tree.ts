import { type Project, type Task } from '../../schema/project.ts'

export const taskChildren = (project: Project, task: Task): readonly Task[] =>
  task.phase._tag === 'Split' ? task.phase.partition.parts.flatMap(({ task }) => {
    const child = project.tasks.get(task)
    return child ? [child] : []
  }) : []
