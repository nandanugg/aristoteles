// The test files that start tmux or a browser. `bun run test:slow` runs them, and
// `bun run test:fast` runs every other file (package.json). Run directly, this file prints the
// words for bun test:
//   bun test/slow-files.js          the path of each slow file
//   bun test/slow-files.js --skip   a --path-ignore-patterns flag for each slow file
const SLOW = [
  'test/page.test.js', // a real browser (test/browser/page.check.js)
  'test/pump.test.js', // real tmux and the fake AI tool
  'test/watcher.test.js', // real tmux, the fake AI tool, and the server
]

const skip = process.argv.includes('--skip')
console.log(SLOW.map((f) => (skip ? `--path-ignore-patterns=${f}` : `./${f}`)).join(' '))
