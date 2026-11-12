// The guides of the tool (guides/*.md and fitness.yaml): files of the tool, not of the dir.
import { join } from 'node:path'

export const GUIDES = join(import.meta.dir, '..', '..', 'guides')
