#!/usr/bin/env bun
// A fake AI tool for the tests of the terminals: it prints, waits, asks, fails and ends on
// purpose. Each line that it reads is a command:
//   fail  -> prints "connection error" and exits with 1
//   ask   -> prints a prompt and waits for its answer
//   quiet -> prints nothing
//   exit  -> exits with 0
//   other -> prints "you said: <line>"
const [mode = 'start', session = '', prompt] = process.argv.slice(2)
process.stdout.write(`fake agent ${mode} ${session} (env ${process.env.ARISTOTELES_SESSION ?? 'none'})\r\n`)
if (prompt) process.stdout.write(`first input: ${prompt}\r\n`)
process.stdout.write('> ')
let asking = false
for await (const chunk of process.stdin) {
  for (const raw of chunk.toString().split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (asking) {
      asking = false
      process.stdout.write(`proceeding with ${line}\r\n> `)
    } else if (line === 'fail') {
      process.stdout.write('connection error\r\n')
      process.exit(1)
    } else if (line === 'ask') {
      asking = true
      process.stdout.write('Do you want to proceed? (1 yes / 2 no)\r\n')
    } else if (line === 'quiet') {
      // nothing
    } else if (line === 'exit') {
      process.exit(0)
    } else {
      process.stdout.write(`you said: ${line}\r\n> `)
    }
  }
}
