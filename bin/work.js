#!/usr/bin/env bun
// The work CLI on a real terminal: real files, clock, git user, and random tokens. The
// project is WORK_DIR, or the nearest folder above the current one with a work.yaml.
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { main } from '../cli.js'

function project(start) {
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'work.yaml'))) return dir
    if (dirname(dir) === dir) return start
  }
}

const io = {
  cwd: process.env.WORK_DIR ?? project(process.cwd()),
  env: process.env,
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
  isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  readLine: (prompt) => globalThis.prompt(prompt),
  now: () => new Date().toISOString(),
  gitUser: () => Bun.spawnSync(['git', 'config', 'user.name']).stdout.toString().trim(),
  // 26 characters of 32: 130 bits, so the hash in the store gives no token back.
  random: () => [...randomBytes(26)].map((b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join(''),
}
process.exitCode = await main(process.argv.slice(2), io)
