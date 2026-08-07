---
name: github-pr-operations
description: Create, inspect, update, and ready GitHub pull requests safely. Use for PR titles, factual bodies and proof of work, duplicate checks, status verification, and marking a draft ready for review.
user-invocable: true
argument-hint: "Describe the pull-request operation, branch, and any required title or proof of work"
---

# GitHub Pull Request Operations

Use this skill for any delegated GitHub pull-request work: inspect a PR, check for a
duplicate, create a PR, update its title or body, or mark a draft ready for review.

## Safety Preflight

Before a mutating operation, confirm all of the following:

1. The operation was explicitly delegated or requested by the user.
2. The active branch is the approved branch and is not `main`.
3. The worktree is understood; do not discard or overwrite unrelated user changes.
4. The repository is discovered dynamically rather than assumed from the current directory.

```bash
BRANCH=$(git branch --show-current)
REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
test -n "$REPO" && test "$BRANCH" != "main"
```

Do not force-push, push to `main`, merge or close a PR, delete a branch, or delete a PR
without the user's explicit request. Do not create a PR when an existing open PR already
represents the branch and change set.

## Inspect and Check for Duplicates

Inspect the current branch and any existing pull request before creating or changing one:

```bash
git status --short
git log --oneline "origin/main..HEAD"
gh pr list --repo "$REPO" --head "$BRANCH" --state open \
  --json number,title,url,isDraft,headRefName
```

If the branch has an open PR, update that PR only when delegated. If the result is empty,
check related open PRs by title or scope before creating a new one:

```bash
gh pr list --repo "$REPO" --state open --limit 100 --json number,title,url,headRefName
```

## Create a Pull Request

Push only the approved non-`main` branch, then create a draft unless the requester explicitly
asks for a ready-for-review PR. Use a concise, imperative title that matches the actual change.

```bash
git push -u origin "$BRANCH"
gh pr create --repo "$REPO" --base main --head "$BRANCH" --draft \
  --title "$TITLE" --body-file "$BODY_FILE"
```

The body must be factual and limited to work performed. Use this template:

```markdown
## Summary
- <what changed>
- <what changed>

## Proof of Work
- Branch: `<branch>`
- Validation: `<command>` - <result>
- Validation: `<command>` - <result>

## Scope
- <intentionally omitted work, limitation, or `None`>
```

Do not claim commands were run, checks passed, reviews happened, or behavior was verified unless
the current session establishes it. Include known failures or unrun checks plainly.

## Update Title or Description

`gh pr edit` can fail because its Projects Classic GraphQL mutation is deprecated. For title or
body updates, use the known working REST endpoint instead. Supply only fields intended to change.

```bash
gh api --method PATCH "repos/$REPO/pulls/$PR_NUMBER" \
  -f title="$TITLE" \
  -f body="$(cat "$BODY_FILE")"
```

Verify the resulting PR content and state:

```bash
gh pr view "$PR_NUMBER" --repo "$REPO" \
  --json number,title,body,url,isDraft,state,headRefName,baseRefName
```

## Mark a Draft Ready for Review

The observed REST ready-for-review endpoint returns `404`; do not retry variations of it.
Use GitHub's GraphQL mutation after dynamically retrieving the PR node ID:

```bash
PR_ID=$(gh api graphql -f query='query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { id }
  }
}' -f owner="${REPO%/*}" -f name="${REPO#*/}" -F number="$PR_NUMBER" \
  --jq '.data.repository.pullRequest.id')

gh api graphql -f query='mutation($pullRequestId: ID!) {
  markPullRequestReadyForReview(input: {pullRequestId: $pullRequestId}) {
    pullRequest { number isDraft url title }
  }
}' -f pullRequestId="$PR_ID"
```

Then verify `isDraft` is `false`:

```bash
gh pr view "$PR_NUMBER" --repo "$REPO" --json number,isDraft,url,title
```

Report the repository, PR number and URL, final draft state, title, body/proof updates, and the
specific verification command and result. Do not create or update a real PR during documentation
or dry-run work unless explicitly directed.