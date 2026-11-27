module splitDependencyCase {
  type Part = Sent | Working | Done
  const exactCoverage: bool
  var state: {
    basis: int, parts: List[List[int]], first: Part, second: Part,
    badPartitionRefused: bool, staleRefused: bool
  }
  action init = state' = { basis: 0, parts: [], first: Sent, second: Sent,
    badPartitionRefused: false, staleRefused: false }
  def covers(parts: List[List[int]]): bool = parts[0].concat(parts[1]) == [1, 2, 3]
  action split = {
    nondet parts = Set([[1], [2, 3]], [[1, 2], [3]], [[1], [1, 3]], [[1], [3]], [[2], [1, 3]]).oneOf()
    nondet read = Set(0, 1).oneOf()
    all {
      state.basis < 2, state.first == Sent, state.second == Sent,
      state' = if (read != state.basis) { ...state, staleRefused: true }
        else if (covers(parts) or not(exactCoverage)) { ...state, parts: parts, basis: state.basis + 1 }
        else { ...state, badPartitionRefused: true }
    }
  }
  action startFirst = all {
    state.basis > 0, state.first == Sent, state' = { ...state, first: Working }
  }
  action finishFirst = all {
    state.first == Working, state' = { ...state, first: Done }
  }
  action startSecond = all {
    state.basis > 0, state.first == Done, state.second == Sent,
    state' = { ...state, second: Working }
  }
  action step = any { split, startFirst, finishFirst, startSecond, state' = state }
  val Safety = all {
    if (state.basis == 0) state.parts == [] else covers(state.parts),
    state.second == Working implies state.first == Done
  }
  val Success = state.basis == 2 and state.second == Working
  val Fault = state.basis == 0 and state.badPartitionRefused and state.staleRefused
}
module splitDependency {
  import splitDependencyCase(exactCoverage = true).* from "./splitDependency"
}
module splitDependencyMutant {
  import splitDependencyCase(exactCoverage = false).* from "./splitDependency"
}
