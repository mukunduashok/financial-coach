---
description: "Implements a feature or bug fix end-to-end: plan → approve → choose branch → implement → test"
agent: "orchestrator"
argument-hint: "Describe the feature/bugfix or paste requirements file path"
---

Implement the following requirement using the full plan → approve → choose branch → prepare branch → implement → test workflow:

${input}

This will coordinate with the orchestrator agent who will:
1. Plan the implementation
2. Ask you for approval
3. Ask whether to create a new branch from the latest `main` or use an existing branch
4. Prepare and confirm the selected non-`main` branch via the developer agent
5. Implement via the developer agent on that branch
6. Run tests via the tester agent on the same branch
