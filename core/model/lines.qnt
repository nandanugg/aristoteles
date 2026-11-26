// Each phase names its duty and the destinations of its moves.
module lines {
  type Duty = Assignee | Reviewer | Proposer | Owner | Engine | Recipient | NoDuty
  type Line[s, m] = s -> { owes: Duty, moves: Set[(m, s)] }
  pure def allows(line: Line[s, m], from: s, move: m, destination: s): bool =
    line.get(from).moves.contains((move, destination))
  pure def owed(line: Line[s, m], phase: s): Duty = line.get(phase).owes

  type Verdict = Pass | Return | Raise(RaiseReason)
  type RaiseReason = Tries | Misses | NoRule | TooBig | ContractWrong | RejectedByHuman
  type Review = Waiting | By(int)
  type Attempt = { number: int, session: int, retries: int, pointedOut: Set[int] }
  type Outcome = { rule: int, breaks: bool, evidence: bool }
  type Result = { artifact: int, attempt: Attempt }
  type ReviewInput = { result: Result, commands: List[Outcome], review: Review }
  type Task =
    | Sent({ last: int, retries: int, pointedOut: Set[int] })
    | Working(Attempt)
    | ReadyToReview(Result)
    | Reviewing(ReviewInput)
    | Done({ result: Result, outcomes: List[Outcome] })
    | Raised(RaiseReason)

  pure val taskLine = Map(
    "Sent" -> { owes: Assignee, moves: Set(("next", "Working")) },
    "Working" -> { owes: Assignee, moves: Set(("next", "ReadyToReview"), ("next", "Sent"), ("raise", "Raised")) },
    "ReadyToReview" -> { owes: Engine, moves: Set(("next", "Reviewing")) },
    "Reviewing" -> { owes: Reviewer, moves: Set(("next", "Reviewing"), ("next", "Done"),
      ("back", "Working"), ("raise", "Raised")) },
    "Done" -> { owes: NoDuty, moves: Set() },
    "Raised" -> { owes: NoDuty, moves: Set() }
  )
  pure def taskPhase(task: Task): str = match task {
    | Sent(_) => "Sent"
    | Working(_) => "Working"
    | ReadyToReview(_) => "ReadyToReview"
    | Reviewing(_) => "Reviewing"
    | Done(_) => "Done"
    | Raised(_) => "Raised"
  }
  pure def taskMove(task: Task, move: str, destination: Task): Task =
    if (allows(taskLine, taskPhase(task), move, taskPhase(destination))) destination else task

  pure val newTask: Task = Sent({ last: 0, retries: 0, pointedOut: Set() })
  pure def beginWork(task: Task, session: int): Task = match task {
    | Sent(sent) => taskMove(task, "next", Working({
        number: sent.last + 1, session: session, retries: sent.retries, pointedOut: sent.pointedOut
      }))
    | _ => task
  }
  pure def reportResult(task: Task, attempt: int, session: int, artifact: int): Task = match task {
    | Working(work) => if (work.number == attempt and work.session == session)
        taskMove(task, "next", ReadyToReview({ artifact: artifact, attempt: work }))
      else task
    | _ => task
  }
  pure def enterReview(task: Task, commands: List[Outcome]): Task = match task {
    | ReadyToReview(result) => taskMove(task, "next", Reviewing({
        result: result, commands: commands, review: Waiting
      }))
    | _ => task
  }
  pure def startReview(task: Task, by: int): Task = match task {
    | Reviewing(input) => if (input.review == Waiting)
        taskMove(task, "next", Reviewing({ ...input, review: By(by) }))
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
                     contractWrong: bool, known: Set[int], attempt: Attempt, limit: int): Verdict = {
    val breaks = broken(command.concat(report)).exclude(known)
    if (contractWrong) Raise(ContractWrong)
    else if (finding) Raise(NoRule)
    else if (breaks == Set()) Pass
    else if (breaks.intersect(attempt.pointedOut) != Set()) Raise(Misses)
    else if (attempt.retries >= limit) Raise(Tries)
    else Return
  }
  pure def reviewTask(task: Task, by: int, reports: List[Outcome], expected: Set[int],
                      finding: bool, contractWrong: bool, known: Set[int], limit: int,
                      checkEvidence: bool): Task = match task {
    | Reviewing(input) =>
      if (input.review != By(by) or (checkEvidence and not(checked(input.commands, reports, expected)))) task
      else {
        val attempt = input.result.attempt
        match judgement(input.commands, reports, finding, contractWrong, known, attempt, limit) {
          | Pass => taskMove(task, "next", Done({ result: input.result, outcomes: input.commands.concat(reports) }))
          | Return => taskMove(task, "back", Working({
              ...attempt, retries: attempt.retries + 1,
              pointedOut: attempt.pointedOut.union(broken(input.commands.concat(reports)).exclude(known))
            }))
          | Raise(reason) => taskMove(task, "raise", Raised(reason))
        }
      }
    | _ => task
  }
  pure def crashTask(task: Task, staff: int, session: int): Task = match task {
    | Working(attempt) => if (attempt.session == session)
        taskMove(task, "next", Sent({
          last: attempt.number, retries: attempt.retries, pointedOut: attempt.pointedOut
        }))
      else task
    | Reviewing(input) => if (input.review == By(staff))
        taskMove(task, "next", Reviewing({ ...input, review: Waiting }))
      else task
    | _ => task
  }
  pure def resumeTask(task: Task, retired: int, current: int): Task = match task {
    | Working(attempt) => if (attempt.session == retired) Working({ ...attempt, session: current }) else task
    | _ => task
  }

  type Proposal = Drafting(int) | ProposalReview({ draft: int, review: Review }) |
    WaitingForOwner(int) | Accepted(int) | Removed
  pure val proposalLine = Map(
    "Drafting" -> { owes: Proposer, moves: Set(("submit", "Reviewing")) },
    "Reviewing" -> { owes: Reviewer, moves: Set(("next", "Reviewing"), ("next", "WaitingForOwner"),
      ("sendBack", "Drafting")) },
    "WaitingForOwner" -> { owes: Owner, moves: Set(("sendBack", "Drafting"), ("accept", "Accepted"),
      ("remove", "Removed")) },
    "Accepted" -> { owes: NoDuty, moves: Set() },
    "Removed" -> { owes: NoDuty, moves: Set() }
  )
  pure def proposalPhase(proposal: Proposal): str = match proposal {
    | Drafting(_) => "Drafting"
    | ProposalReview(_) => "Reviewing"
    | WaitingForOwner(_) => "WaitingForOwner"
    | Accepted(_) => "Accepted"
    | Removed => "Removed"
  }
  pure def proposalMove(proposal: Proposal, move: str, destination: Proposal): Proposal =
    if (allows(proposalLine, proposalPhase(proposal), move, proposalPhase(destination))) destination else proposal

  pure def submit(proposal: Proposal): Proposal = match proposal {
    | Drafting(draft) => proposalMove(proposal, "submit", ProposalReview({ draft: draft, review: Waiting }))
    | _ => proposal
  }
  pure def reviewProposal(proposal: Proposal, by: int): Proposal = match proposal {
    | ProposalReview(input) => if (input.review == Waiting)
        proposalMove(proposal, "next", ProposalReview({ ...input, review: By(by) }))
      else proposal
    | _ => proposal
  }
  pure def proposalFacts(proposal: Proposal, by: int, holds: bool): Proposal = match proposal {
    | ProposalReview(input) => if (input.review != By(by)) proposal
      else if (holds) proposalMove(proposal, "next", WaitingForOwner(input.draft))
      else proposalMove(proposal, "sendBack", Drafting(input.draft))
    | _ => proposal
  }
  pure def ownerChoice(proposal: Proposal, actor: int, owner: int, draft: int, choice: str): Proposal =
    if (actor != owner or proposal != WaitingForOwner(draft)) proposal
    else if (choice == "accept") proposalMove(proposal, "accept", Accepted(draft))
    else if (choice == "remove") proposalMove(proposal, "remove", Removed)
    else proposalMove(proposal, "sendBack", Drafting(draft + 1))
  pure def crashProposal(proposal: Proposal, staff: int): Proposal = match proposal {
    | ProposalReview(input) => if (input.review == By(staff))
        proposalMove(proposal, "next", ProposalReview({ ...input, review: Waiting }))
      else proposal
    | _ => proposal
  }
}
