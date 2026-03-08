Create a pull request for the current branch with a changeset.

## Steps

### 1. Changeset
- Check if there are already changeset files in `.changeset/` (other than config.json and README.md)
- If no changeset exists, create one:
  - Look at the git diff against main to understand the changes
  - Determine the appropriate semver bump (patch for fixes, minor for features, major for breaking changes)
  - Create a changeset markdown file in `.changeset/` with a descriptive summary
  - The file should be named with a random adjective-noun combo (e.g., `brave-pandas.md`)
  - Format:
    ```
    ---
    "ultradev-dashboard": <patch|minor|major>
    ---

    <Summary of changes>
    ```

### 2. Commit
- Stage any new or modified files (including the changeset)
- Create a commit with an appropriate message

### 3. Pull Request
- Push the branch to origin
- Create a PR using `gh pr create`
- Use a clear, concise title (under 70 characters)
- Include a summary of changes and test plan in the PR body
- Format:
  ```
  ## Summary
  <bullet points>

  ## Test plan
  <checklist>

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  ```

### 4. Output
- Print the PR URL when done
