#!/bin/sh
# The mutation check of the replay: each mutation below breaks a copy of the TS core in one small
# way; the replay test and the c16 unit tests run on the copy, one failing catches it (the mutant is caught). A mutant the replay
# passes is a gap in the replay and is reported as SURVIVED (exit 1).
# Kinds: the replay checks that the core accepts every act the model took, that the state after
# each act is the model's, and that the told steps are the model's. So a guard made too strict, a
# wrong effect and a wrong told step are caught; a guard dropped (the core accepts more than the
# model) is not, since the model never takes an act it refuses: those are listed last, as the
# known blind spot, and reported as survivors.
set -e
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../../.." && pwd)
work=$(mktemp -d "${TMPDIR:-/var/tmp}/replay-mutants.XXXXXX")
trap 'rm -r "${work:?}"' EXIT
cd "$root"

python3 - "$root" "$work" <<'PY'
import os, shutil, subprocess, sys
root, work = sys.argv[1], sys.argv[2]
EFFECT = 'core/state/c16/effect.ts'
ACCEPT = 'core/derived/c16/accept.ts'
OBLIG = 'core/derived/c16/obligations.ts'
# (name, file, old text, new text)
MUTANTS = [
  ('effect: a failed review does not count the try', EFFECT,
   "setT(closed, i, (z) => ({ ...z, state: 'Working', tries: z.tries + 1 }))",
   "setT(closed, i, (z) => ({ ...z, state: 'Working', tries: z.tries }))"),
  ('effect: a raise for tries forgets the try', EFFECT,
   'return raise(closed, i, t.tries + 1, roleOf(t))',
   'return raise(closed, i, t.tries, roleOf(t))'),
  ('effect: the review loop climbs a round late', EFFECT,
   'z.loopRounds >= 1\n          ? loopClimb(z)', 'z.loopRounds >= 2\n          ? loopClimb(z)'),
  ('effect: a rule failing its tests climbs at once', EFFECT,
   "z.ruleTries >= 1\n        ? { ...ruleClimb(z)", "true\n        ? { ...ruleClimb(z)"),
  ('effect: a standard change leaves the floor at direction for a principle task', EFFECT,
   "floor: fixAt(f) >= 2 || z.floor === 'Principle' ? 'Principle' : 'Direct',",
   "floor: 'Direct',"),
  ('effect: a read brief claims without taking the versions', EFFECT,
   "setM(s, w.maker, (y) => ({ ...y, claimed: true, brief: s.ver }))",
   "setM(s, w.maker, (y) => ({ ...y, claimed: true }))"),
  ('obligations: the host is told TopDone while a task is not done', OBLIG,
   "hostOn && allDone(s) && !s.top.done", "hostOn && !s.top.done"),
  ('obligations: an answerer that just answered is told its answers too', OBLIG,
   "if (s.justAnswered.has(keyOf(actor)) && own.length > 0) return own",
   "if (false && own.length > 0) return own"),
  ('obligations: the host is told to reassign with no accepted fix', OBLIG,
   "hostOn && accepted !== null ? [step('Reassign', { fix: accepted })] : []",
   "hostOn ? [step('Reassign', { fix: accepted ?? '' })] : []"),
  ('accept: a pass is refused for every result', ACCEPT,
   "return t.caught.size === 0", "return false"),
  ('accept: an answer is refused while the answerer has own steps, always', ACCEPT,
   "!(s.justAnswered.has(keyOf(ask.to)) && ownToldSteps(s, ask.to).length > 0)",
   "ownToldSteps(s, ask.to).length === 0"),
  # the blind spot: guards dropped (the core accepts more than the model)
  ('accept (blind spot): Hear needs no answered ask', ACCEPT,
   "case 'Hear':\n      return s.answered.has(b.ask)", "case 'Hear':\n      return true"),
  ('accept (blind spot): a pass ignores the test commands', ACCEPT,
   "return t.caught.size === 0", "return true"),
]
def run(name, path, old, new):
  copy = os.path.join(work, 'copy')
  shutil.rmtree(copy, ignore_errors=True)
  os.makedirs(copy)
  shutil.copytree(os.path.join(root, 'core'), os.path.join(copy, 'core'))
  for f in ('src', 'test', 'node_modules', 'package.json', 'tsconfig.json', 'bunfig.toml'):
    os.symlink(os.path.join(root, f), os.path.join(copy, f))
  target = os.path.join(copy, path)
  text = open(target).read()
  if text.count(old) != 1:
    return 'PATTERN MISSING'
  open(target, 'w').write(text.replace(old, new))
  tests = ['core/derived/c16/replay/replay.test.ts'] + [
    os.path.join(d, f) for d in ('core/state/c16', 'core/derived/c16')
    for f in sorted(os.listdir(os.path.join(copy, d))) if f.endswith('.test.ts')]
  r = subprocess.run(['bun', 'test', '--parallel=2'] + tests, cwd=copy,
                     capture_output=True, text=True)
  return 'caught' if r.returncode != 0 else 'SURVIVED'
# the copy with no mutation must pass, or every mutant would look caught
base = run('baseline', MUTANTS[0][1], MUTANTS[0][2], MUTANTS[0][2])
if base != 'SURVIVED':
  print('the unmutated copy fails the replay:', base)
  sys.exit(2)
bad = 0
for name, path, old, new in MUTANTS:
  verdict = run(name, path, old, new)
  print(f'{verdict:16} {name}', flush=True)
  bad += verdict != 'caught'
print(f'{len(MUTANTS) - bad} of {len(MUTANTS)} caught')
sys.exit(1 if bad else 0)
PY
