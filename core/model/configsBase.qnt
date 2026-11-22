// Shared options and bounds for the protocol and resource-admitted instances.
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
