// The instances and mutants of the checked protocol.

// ---- instances (tlc.sh keeps only the one it checks: quint's TLA+ export of a file with
// many instances overflows).
// Two tasks: task 0 with a standard cause, task 1 with none. Its rule may contradict task
// 1's (fights), its change may break task 1 (breaksTasks): scoped rechecks, rechecks of a done
// task, the person's take as is (one act).
module coreTwo {
  import configsBase.* from "./configsBase"
  import types.* from "./types"
  import properties(OPTIONS = FIXED_OPTIONS,
    LIMITS = { ...BASE_LIMITS, causesTask0: Set(AT_STANDARD), causesTask1: Set(NO_CAUSE),
               testsMayFail: false }).* from "./properties"
}

// The same with a direction cause: a direction change, the person, the host's reassign,
// the recheck of every task.
module coreTwoDir {
  import configsBase.* from "./configsBase"
  import types.* from "./types"
  import properties(OPTIONS = FIXED_OPTIONS,
    LIMITS = { ...BASE_LIMITS, causesTask0: Set(AT_DIRECT), causesTask1: Set(NO_CAUSE),
               testsMayFail: false }).* from "./properties"
}

// No caps on agents; a repeated failure climbs the ladder. A rule that keeps failing its own
// examples, and a draft the review loop keeps sending back, each reach the person; the person
// sends a draft back at most 3 times.
module coreLoops {
  import configsBase.* from "./configsBase"
  import types.* from "./types"
  import properties(OPTIONS = { ...FIXED_OPTIONS, slots: Set(0) },
    LIMITS = { ...BASE_LIMITS, causesTask0: Set(AT_DIRECT, AT_STANDARD),
               causesTask1: Set(NO_CAUSE), maxPersonActs: 1, sendBacksPerDraft: 3 })
    .* from "./properties"
}

// Cross checks of the pending guidance, with a test command on every rule.
module coreCrossOnly {
  import configsBase.* from "./configsBase"
  import types.* from "./types"
  import properties(OPTIONS = { ...FIXED_OPTIONS, raiseLevel: false },
    LIMITS = { ...BASE_LIMITS, causesTask0: Set(AT_STANDARD), causesTask1: Set(AT_STANDARD),
               maxPersonActs: 0, ruleForms: Set(Mech), testsMayFail: false }).* from "./properties"
}

// A send to slot 1 carries an output fact. A representative split part can acquire it in
// either slot, and all scope reads must use the current task's facts.
module coreWhereContext {
  import configsBase.* from "./configsBase"
  import types.* from "./types"
  import properties(OPTIONS = { ...FIXED_OPTIONS, scopeOutput: true },
    LIMITS = { ...BASE_LIMITS, causesTask0: Set(AT_SPLIT, NO_CAUSE),
               causesTask1: Set(NO_CAUSE), maxPersonActs: 0, testsMayFail: false }).* from "./properties"
}
