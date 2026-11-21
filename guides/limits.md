# Limits: the action when work passes one

A limit keeps the work of a role inside what its model does well. When work passes a limit, the
CLI refuses the act and names the limit. Do the action of that limit below. Do not ask the
person about a limit.

## The limits of a model (`models.<model>.limits` in `aristoteles.yaml`)

### `Assignment.attempts`: the tries before a raise

- **It keeps:** a maker that fails again and again from more tries of the same work.
- **When work passes it:** the role reviewed the result `attempts` times and it still fails.
  The default is three tries; the model with the fewest tries sets it. Tries are the only cap:
  there is no other budget.
- **The action:** raise the task (`work review <token> <ask-id> raise-tries --points="..." --on <n>`).
  The pipeline role then evaluates the cause (split, fit, principle, direction, standard).

### `Review.rules`: the rules of one review

- **It keeps:** the attention of a role that checks each rule on one result.
- **When work passes it:** `work role fit` counts the rules that name the role, and the static
  check fails.
- **The action:** give each task fewer rules of that role: a `where` for the standards that
  need only some sections, merge two rules that check one thing, or split the task.

## The limit of a direction

### `maxStandards`: the standards of one direction

- **When work passes it:** the draft of the direction is refused.
- **The action:** merge two standards that say one thing, or move a group of standards to a
  new direction of their own.

## The limits that the UI handles

Nobody acts on these by hand, and nobody asks the person about them: a terminal that ends,
shows error words, or is silent for `models.<model>.silentMinutes` is tried again, then shown on
the page.
