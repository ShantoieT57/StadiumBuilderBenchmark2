# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

All instructions in this file apply to the back-end of the application, which is located in the folder named `app-backend` in the repo root.

## Back-end code changes — always delegate to the `backend-workflow` sub-agent

Every back-end code change MUST go through the `backend-workflow` sub-agent. This includes any new feature, bug fix, or refactoring that touches the `app-backend` folder.

Whenever a change to the back-end is required, you MUST invoke the `backend-workflow` sub-agent (via the Agent tool) to carry out the work. Do not write production or test code or update the OpenAPI spec yourself — that mandatory Specification + Red-Green-Refactor BDD process lives entirely in the sub-agent.

Pass the requested change to the sub-agent in your own words. If the feature or change applies to a new REST host that must be added, include a descriptive name for the service that is a valid C# identifier. The sub-agent services the request from start to finish without stopping to verify service names, OpenAPI spec changes, or Gherkin tests, and returns a summary of what it implemented once the cycle is green and refactored. When it returns, proceed to the manual-testing & commit gate below.

## Manual testing & committing a completed cycle

Committing is part of the main process, not the sub-agent. When the `backend-workflow` sub-agent returns a cycle as complete (green and refactored), do the following before invoking it again for any further cycle:

1. **STOP. Do not stage or commit anything yet.** Ask the user to confirm that manual testing has been done on the new feature, bug fix, or refactoring. Wait for their explicit confirmation before proceeding. Do not skip this gate for any reason.
2. Once the user has confirmed manual testing, stage all changes made during the cycle (both production and test code) and create a git commit with a concise message describing the feature, bug fix, or refactoring.
   - **Never pass a multi-line commit message as an inline PowerShell here-string** (e.g. ``git commit -m @'...'@``). When used in a Bash-shell, each `@` will be interpreted as part of the commit message. Omit the `@` characters, e.g. ``git commit -m '...'``.
3. Do not start the next Red-Green-Refactor cycle (by re-invoking the sub-agent) until the commit has been created.
