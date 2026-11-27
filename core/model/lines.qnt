// Each phase names its duty and the destinations of its moves.
module lines {
  type PhaseKey = | NoPayload
  type Duty = Assignee | Reviewer | Proposer | Owner | Engine | Recipient | NoDuty
  type Line[s, m] = s -> { owes: Duty, moves: Set[(m, s)] }
  pure def allows(line: Line[s, m], from: s, move: m, destination: s): bool =
    line.get(from).moves.contains((move, destination))
  pure def owed(line: Line[s, m], phase: s): Duty = line.get(phase).owes

  type RaiseReason = Tries | Misses | NoRule | TooBig | WrongTask | ContractWrong | RejectedByHuman
  type Review = Waiting | By(int)
  type Attempt = { number: int, session: int, retries: int, pointedOut: Set[int] }
  type Outcome = { rule: int, breaks: bool, evidence: bool }
  type Result = { artifact: int, attempt: Attempt }
  type ReviewInput = { result: Result, commands: List[Outcome], review: Review }
  type TaskPhase[sent, work, ready, review, done, raised] =
    Sent(sent) | Working(work) | ReadyToReview(ready) | Reviewing(review) | Done(done) | Raised(raised)
  type Task = TaskPhase[{ last: int, retries: int, pointedOut: Set[int] }, Attempt, Result,
    ReviewInput, { result: Result, outcomes: List[Outcome] }, RaiseReason]
  type TaskKey = TaskPhase[PhaseKey, PhaseKey, PhaseKey, PhaseKey, PhaseKey, PhaseKey]

  type TaskMove = Next | Back | Raise(RaiseReason) | Restart | ReleaseTaskReview
  pure val raises: Set[(TaskMove, TaskKey)] =
    Set(Tries, Misses, NoRule, TooBig, WrongTask, ContractWrong, RejectedByHuman).map(reason => (Raise(reason), Raised(NoPayload)))
  pure val taskLine: Line[TaskKey, TaskMove] = Map(
    Sent(NoPayload) -> { owes: Assignee, moves: Set((Next, Working(NoPayload))) },
    Working(NoPayload) -> { owes: Assignee,
      moves: Set((Next, ReadyToReview(NoPayload)), (Restart, Sent(NoPayload))).union(raises) },
    ReadyToReview(NoPayload) -> { owes: Engine, moves: Set((Next, Reviewing(NoPayload))) },
    Reviewing(NoPayload) -> { owes: Reviewer,
      moves: Set((Next, Reviewing(NoPayload)), (ReleaseTaskReview, Reviewing(NoPayload)), (Next, Done(NoPayload)), (Back, Working(NoPayload))).union(raises) },
    Done(NoPayload) -> { owes: NoDuty, moves: Set() },
    Raised(NoPayload) -> { owes: NoDuty, moves: Set() }
  )
  pure def taskPhase(task: Task): TaskKey = match task {
    | Sent(_) => Sent(NoPayload)
    | Working(_) => Working(NoPayload)
    | ReadyToReview(_) => ReadyToReview(NoPayload)
    | Reviewing(_) => Reviewing(NoPayload)
    | Done(_) => Done(NoPayload)
    | Raised(_) => Raised(NoPayload)
  }
  pure def taskMove(task: Task, move: TaskMove, destination: Task): Task =
    if (allows(taskLine, taskPhase(task), move, taskPhase(destination))) destination else task

  pure val newTask: Task = Sent({ last: 0, retries: 0, pointedOut: Set() })
  pure def beginWork(task: Task, session: int): Task = match task {
    | Sent(sent) => taskMove(task, Next, Working({
        number: sent.last + 1, session: session, retries: sent.retries, pointedOut: sent.pointedOut
      }))
    | _ => task
  }
  pure def reportResult(task: Task, attempt: int, session: int, artifact: int): Task = match task {
    | Working(work) => if (work.number == attempt and work.session == session)
        taskMove(task, Next, ReadyToReview({ artifact: artifact, attempt: work }))
      else task
    | _ => task
  }
  pure def enterReview(task: Task, commands: List[Outcome]): Task = match task {
    | ReadyToReview(result) => taskMove(task, Next, Reviewing({
        result: result, commands: commands, review: Waiting
      }))
    | _ => task
  }
  pure def startReview(task: Task, by: int): Task = match task {
    | Reviewing(input) => if (input.review == Waiting)
        taskMove(task, Next, Reviewing({ ...input, review: By(by) }))
      else task
    | _ => task
  }

  pure def checked(commands: List[Outcome], reports: List[Outcome], expected: Set[int]): bool = {
    val outcomes = commands.concat(reports)
    outcomes.length() == expected.size() and
      outcomes.foldl(Set(), (seen, outcome) => seen.union(Set(outcome.rule))) == expected and
      outcomes.foldl(true, (valid, outcome) => valid and outcome.evidence)
  }
  pure def broken(outcomes: List[Outcome]): Set[int] =
    outcomes.foldl(Set(), (hits, outcome) => if (outcome.breaks) hits.union(Set(outcome.rule)) else hits)
  pure def judgement(command: List[Outcome], report: List[Outcome], finding: bool,
                     contractWrong: bool, known: Set[int], attempt: Attempt, limit: int): TaskMove = {
    val breaks = broken(command.concat(report)).exclude(known)
    if (contractWrong) Raise(ContractWrong)
    else if (finding) Raise(NoRule)
    else if (breaks == Set()) Next
    else if (breaks.intersect(attempt.pointedOut) != Set()) Raise(Misses)
    else if (attempt.retries >= limit) Raise(Tries)
    else Back
  }
  pure def reviewTask(task: Task, by: int, reports: List[Outcome], expected: Set[int],
                      finding: bool, contractWrong: bool, known: Set[int], limit: int,
                      checkEvidence: bool): Task = match task {
    | Reviewing(input) =>
      if (input.review != By(by) or (checkEvidence and not(checked(input.commands, reports, expected)))) task
      else {
        val attempt = input.result.attempt
        val derived = judgement(input.commands, reports, finding, contractWrong, known, attempt, limit)
        match derived {
          | Next => taskMove(task, derived, Done({ result: input.result, outcomes: input.commands.concat(reports) }))
          | Back => taskMove(task, derived, Working({
              ...attempt, retries: attempt.retries + 1,
              pointedOut: attempt.pointedOut.union(broken(input.commands.concat(reports)).exclude(known))
            }))
          | Raise(reason) => taskMove(task, derived, Raised(reason))
          | Restart => task
          | ReleaseTaskReview => task
        }
      }
    | _ => task
  }
  pure def restartTask(task: Task, session: int): Task = match task {
    | Working(attempt) => if (attempt.session == session)
        taskMove(task, Restart, Sent({
          last: attempt.number, retries: attempt.retries, pointedOut: attempt.pointedOut
        }))
      else task
    | _ => task
  }
  pure def releaseTaskReview(task: Task, staff: int): Task = match task {
    | Reviewing(input) => if (input.review == By(staff))
        taskMove(task, ReleaseTaskReview, Reviewing({ ...input, review: Waiting }))
      else task
    | _ => task
  }
  type ProposalPhase[draft, review] =
    Drafting(draft) | ProposalReview(review) | WaitingForOwner(draft) | Accepted(draft) | Removed
  type Proposal = ProposalPhase[int, { draft: int, review: Review }]
  type ProposalKey = ProposalPhase[PhaseKey, PhaseKey]
  type ProposalMove = ProposalNext | Submit | SendBack | Accept | Remove | ReleaseProposalReview
  pure val proposalLine: Line[ProposalKey, ProposalMove] = Map(
    Drafting(NoPayload) -> { owes: Proposer, moves: Set((Submit, ProposalReview(NoPayload))) },
    ProposalReview(NoPayload) -> { owes: Reviewer, moves: Set((ProposalNext, ProposalReview(NoPayload)), (ReleaseProposalReview, ProposalReview(NoPayload)),
      (ProposalNext, WaitingForOwner(NoPayload)), (SendBack, Drafting(NoPayload))) },
    WaitingForOwner(NoPayload) -> { owes: Owner, moves: Set((SendBack, Drafting(NoPayload)),
      (Accept, Accepted(NoPayload)), (Remove, Removed)) },
    Accepted(NoPayload) -> { owes: NoDuty, moves: Set() },
    Removed -> { owes: NoDuty, moves: Set() }
  )
  pure def proposalPhase(proposal: Proposal): ProposalKey = match proposal {
    | Drafting(_) => Drafting(NoPayload)
    | ProposalReview(_) => ProposalReview(NoPayload)
    | WaitingForOwner(_) => WaitingForOwner(NoPayload)
    | Accepted(_) => Accepted(NoPayload)
    | Removed => Removed
  }
  pure def proposalMove(proposal: Proposal, move: ProposalMove, destination: Proposal): Proposal =
    if (allows(proposalLine, proposalPhase(proposal), move, proposalPhase(destination))) destination else proposal

  pure def submit(proposal: Proposal): Proposal = match proposal {
    | Drafting(draft) => proposalMove(proposal, Submit, ProposalReview({ draft: draft, review: Waiting }))
    | _ => proposal
  }
  pure def reviewProposal(proposal: Proposal, by: int): Proposal = match proposal {
    | ProposalReview(input) => if (input.review == Waiting)
        proposalMove(proposal, ProposalNext, ProposalReview({ ...input, review: By(by) }))
      else proposal
    | _ => proposal
  }
  pure def proposalFacts(proposal: Proposal, by: int, holds: bool): Proposal = match proposal {
    | ProposalReview(input) => if (input.review != By(by)) proposal
      else if (holds) proposalMove(proposal, ProposalNext, WaitingForOwner(input.draft))
      else proposalMove(proposal, SendBack, Drafting(input.draft))
    | _ => proposal
  }
  pure def ownerChoice(proposal: Proposal, actor: int, owner: int, draft: int, choice: ProposalMove): Proposal =
    if (actor != owner or proposal != WaitingForOwner(draft)) proposal
    else match choice {
      | Accept => proposalMove(proposal, choice, Accepted(draft))
      | Remove => proposalMove(proposal, choice, Removed)
      | SendBack => proposalMove(proposal, choice, Drafting(draft + 1))
      | _ => proposal
    }
  pure def releaseProposalReview(proposal: Proposal, staff: int): Proposal = match proposal {
    | ProposalReview(input) => if (input.review == By(staff))
        proposalMove(proposal, ReleaseProposalReview, ProposalReview({ ...input, review: Waiting }))
      else proposal
    | _ => proposal
  }
}
