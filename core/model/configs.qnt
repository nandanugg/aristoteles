// The limits and the instances of the checked model: the protocol options with every check
// on (FIXED_OPTIONS), the limits of a run (BASE_LIMITS), and one module per instance or mutant.
// An instance imports properties.qnt, which brings the model (check.qnt) and the properties.
module configsBase {
  import types.* from "./types"
  // The real causes (types.qnt Cause): none, or one level of the ladder.
  pure val NO_CAUSE = NoCause
  pure val AT_SPLIT = CauseAt(Split)
  pure val AT_FIT = CauseAt(Fit)
  pure val AT_PRINCIPLE = CauseAt(Principle)
  pure val AT_DIRECT = CauseAt(Direct)
  pure val AT_STANDARD = CauseAt(Standard)
  // Every proposed check on.
  pure val FIXED_OPTIONS = { crossTest: true, raiseLevel: true, recheckBasis: true,
    slots: Set(0, 1), basis: true, build: true, rebase: true, harnessTest: true, classify: true,
    passTests: true, fullBrief: true, endedCheck: true, formCheck: true, refCheck: true,
    epochs: true, reviseCheck: true, rebind: true, pumpReattach: true, hostWatched: true,
    promptArg: true, idleSeen: true, silentSteps: 3, reviewSubagents: false, editBack: 1,
    acceptCheck: true, decideRecheck: true, briefCheck: true, strictScope: true, sections: 2,
    listOnAttach: true, ladderRoute: true, ruleLadder: true, loopLadder: true, maxTries: 2,
    makerAsks: false }
  // The limits a run starts from (a task may start with no cause or a standard one); each
  // instance changes some.
  pure val BASE_LIMITS = { causesTask0: Set(NO_CAUSE, AT_STANDARD),
    causesTask1: Set(NO_CAUSE, AT_STANDARD), maxPersonActs: 1, maxMistakes: 0,
    makerMaySlip: false, ruleForms: Set(Mech, Ref), testsMayFail: true, personMayReject: false,
    maxExits: 0, personSendBackBound: true, sendBacksPerDraft: 1, maxAsks: 0,
    rogueMaker: false }
  pure val ALL_CAUSES = Set(NO_CAUSE, AT_SPLIT, AT_FIT, AT_PRINCIPLE, AT_DIRECT, AT_STANDARD)
}

// ---- instances (tlc.sh keeps only the one it checks: quint's TLA+ export of a file with
// many instances overflows).
// Two tasks: task 0 with a standard cause, task 1 with none. Its rule may contradict task
// 1's (fights), its change may break task 1 (breaksTasks): scoped rechecks, rechecks of a done
// task, the person's take as is (one act).
module coreTwo {
  import configsBase.*
  import types.* from "./types"
  import properties(OPTIONS = FIXED_OPTIONS,
    LIMITS = { ...BASE_LIMITS, causesTask0: Set(AT_STANDARD), causesTask1: Set(NO_CAUSE),
               testsMayFail: false }).* from "./properties"
}

// The same with a direction cause: a direction change, the person, the host's reassign,
// the recheck of every task.
module coreTwoDir {
  import configsBase.*
  import types.* from "./types"
  import properties(OPTIONS = FIXED_OPTIONS,
    LIMITS = { ...BASE_LIMITS, causesTask0: Set(AT_DIRECT), causesTask1: Set(NO_CAUSE),
               testsMayFail: false }).* from "./properties"
}

// coreTwo with one process end: an exit of the host, a role, the pipeline role or a maker, its
// revive (the harness), its resume (the role), the host started again by the person. One
// person act and no send-back (with two acts and a send-back TLC passed 1.25 million states
// at 40 minutes, still growing).
module coreTwoExit {
  import configsBase.*
  import types.* from "./types"
  import properties(OPTIONS = FIXED_OPTIONS,
    LIMITS = { ...BASE_LIMITS, causesTask0: Set(AT_STANDARD), causesTask1: Set(NO_CAUSE),
               testsMayFail: false, maxPersonActs: 1, sendBacksPerDraft: 0, maxExits: 1 })
    .* from "./properties"
}

// No caps on agents; a repeated failure climbs the ladder. A rule that keeps failing its own
// examples, and a draft the review loop keeps sending back, each reach the person; the person
// sends a draft back at most 3 times.
module coreLoops {
  import configsBase.*
  import types.* from "./types"
  import properties(OPTIONS = { ...FIXED_OPTIONS, slots: Set(0) },
    LIMITS = { ...BASE_LIMITS, causesTask0: Set(AT_DIRECT, AT_STANDARD),
               causesTask1: Set(NO_CAUSE), maxPersonActs: 1, sendBacksPerDraft: 3 })
    .* from "./properties"
}

// The mutants: without the ladder on rule rewrites, or on the review loop, the pipeline role
// may loop for ever; with the person unbounded the run depends on the person (expected).
module coreNoRuleLadder {
  import configsBase.*
  import types.* from "./types"
  import properties(OPTIONS = { ...FIXED_OPTIONS, slots: Set(0), ruleLadder: false },
    LIMITS = { ...BASE_LIMITS, causesTask0: Set(AT_STANDARD), causesTask1: Set(NO_CAUSE),
               maxPersonActs: 0 }).* from "./properties"
}

module coreNoLoopLadder {
  import configsBase.*
  import types.* from "./types"
  import properties(OPTIONS = { ...FIXED_OPTIONS, slots: Set(0), loopLadder: false },
    LIMITS = { ...BASE_LIMITS, causesTask0: Set(AT_DIRECT), causesTask1: Set(NO_CAUSE),
               maxPersonActs: 0 }).* from "./properties"
}

module corePersonUnbounded {
  import configsBase.*
  import types.* from "./types"
  import properties(OPTIONS = { ...FIXED_OPTIONS, slots: Set(0) },
    LIMITS = { ...BASE_LIMITS, causesTask0: Set(AT_DIRECT), causesTask1: Set(NO_CAUSE),
               maxPersonActs: -1, personSendBackBound: false }).* from "./properties"
}

// One task with no cause (host -> role -> maker -> the role's check), no slips or mistakes. Two
// questions that cross between any actors in both directions, the person a target too, while
// executes and checks are open: no wait cycle, the cap, the alternation, no deadlock; the
// person's answers and NoFinalWithAsk live here. (Any pipeline cause makes the space too big for
// TLC: coreAsksPipe checks questions while the evaluate and decide waits are open.)
module coreAsks {
  import configsBase.*
  import types.* from "./types"
  import properties(OPTIONS = { ...FIXED_OPTIONS, slots: Set(0) },
    LIMITS = { ...BASE_LIMITS, causesTask0: Set(NO_CAUSE), causesTask1: Set(NO_CAUSE),
               maxPersonActs: 2, sendBacksPerDraft: 0, maxAsks: 2 })
    .* from "./properties"
}

// The pipeline on its shortest path that still opens evaluate and decide (a direction cause:
// a raise to the pipeline role, the draft at the person), reference rules only, no failing
// tests, no mistakes, slips or rejects, one person act, one question that may cross (the person
// a target too): questions while the evaluate and decide waits are open.
module coreAsksPipe {
  import configsBase.*
  import types.* from "./types"
  import properties(OPTIONS = { ...FIXED_OPTIONS, slots: Set(0) },
    LIMITS = { ...BASE_LIMITS, causesTask0: Set(AT_DIRECT), causesTask1: Set(NO_CAUSE),
               ruleForms: Set(Ref), testsMayFail: false, maxPersonActs: 1,
               sendBacksPerDraft: 0, maxAsks: 1 })
    .* from "./properties"
}

// One task, causes none and principle, the person's reject, a maker that slips, one shallow
// evaluation, and a rogue maker: it asks its role again and again (the cap, then a raise); the
// role's own work still finishes (AnswererFinishes, CoreProgress, CoreSettles).
module coreAskRogue {
  import configsBase.*
  import types.* from "./types"
  import properties(OPTIONS = { ...FIXED_OPTIONS, slots: Set(0) },
    LIMITS = { ...BASE_LIMITS, causesTask0: Set(NO_CAUSE, AT_PRINCIPLE),
               causesTask1: Set(NO_CAUSE), maxPersonActs: 2, maxMistakes: 1, makerMaySlip: true,
               personMayReject: true, sendBacksPerDraft: 0, rogueMaker: true })
    .* from "./properties"
}

// The mutant of the wait order: the store lets a maker ask its role to execute (the reverse
// of the role's Execute to it), the normal steps run: NoWaitCycle must break.
module coreAskReverse {
  import configsBase.*
  import types.* from "./types"
  import properties(OPTIONS = { ...FIXED_OPTIONS, slots: Set(0), makerAsks: true },
    LIMITS = { ...BASE_LIMITS, causesTask0: Set(NO_CAUSE), causesTask1: Set(NO_CAUSE),
               maxPersonActs: 0 }).* from "./properties"
}

// The simulator only (too big for TLC): two tasks, every cause, the person's acts.
module coreAll {
  import configsBase.*
  import types.* from "./types"
  import properties(OPTIONS = FIXED_OPTIONS,
    LIMITS = { ...BASE_LIMITS, causesTask0: ALL_CAUSES, causesTask1: ALL_CAUSES,
               maxPersonActs: 2, maxMistakes: 1, makerMaySlip: true, personMayReject: true })
    .* from "./properties"
}

// The "before" mutants: TLC must show agent changes that never
// stop (CoreChangesStop and CoreProgress break). No person acts: the loop is the agents'.
// No level raise (raiseLevel off): a contradiction through a reference-only rule (no test
// command, so the cross test cannot see it) ping-pongs between the two tasks' rules.
module coreNoRaise {
  import configsBase.*
  import types.* from "./types"
  import properties(OPTIONS = { ...FIXED_OPTIONS, raiseLevel: false },
    LIMITS = { ...BASE_LIMITS, causesTask0: Set(AT_STANDARD), causesTask1: Set(AT_STANDARD),
               maxPersonActs: 0, testsMayFail: false }).* from "./properties"
}

// No cross test and no level raise, every rule with a test command: the ping-pong.
module coreNoCross {
  import configsBase.*
  import types.* from "./types"
  import properties(OPTIONS = { ...FIXED_OPTIONS, crossTest: false, raiseLevel: false },
    LIMITS = { ...BASE_LIMITS, causesTask0: Set(AT_STANDARD), causesTask1: Set(AT_STANDARD),
               maxPersonActs: 0, ruleForms: Set(Mech), testsMayFail: false }).* from "./properties"
}

// Its twin: the cross test alone ends it when every rule has a test command (holds).
module coreCrossOnly {
  import configsBase.*
  import types.* from "./types"
  import properties(OPTIONS = { ...FIXED_OPTIONS, raiseLevel: false },
    LIMITS = { ...BASE_LIMITS, causesTask0: Set(AT_STANDARD), causesTask1: Set(AT_STANDARD),
               maxPersonActs: 0, ruleForms: Set(Mech), testsMayFail: false }).* from "./properties"
}

// No split limit (strictScope and raiseLevel off): a split part splits again, for ever.
module coreNoSplit {
  import configsBase.*
  import types.* from "./types"
  import properties(OPTIONS = { ...FIXED_OPTIONS, slots: Set(0), strictScope: false,
                 raiseLevel: false },
    LIMITS = { ...BASE_LIMITS, causesTask0: Set(AT_SPLIT), causesTask1: Set(NO_CAUSE),
               maxPersonActs: 0 }).* from "./properties"
}
