---
description: "Start a specification interview for a feature"
argument-hint: "FEATURE_NAME [--context FILE] [--output-dir DIR] [--max-questions N]"
allowed-tools: ["Bash(${CLAUDE_PLUGIN_ROOT}/scripts/setup-lisa-plan.sh:*)", "AskUserQuestion", "Read", "Write", "Glob", "Grep"]
hide-from-slash-command-tool: "true"
---

# Lisa Plan Command

Execute the setup script to initialize the specification interview:

```!
"${CLAUDE_PLUGIN_ROOT}/scripts/setup-lisa-plan.sh" $ARGUMENTS
```

You are now conducting a comprehensive specification interview. Follow the instructions provided by the setup script exactly.

REMEMBER:
1. EVERY question must use AskUserQuestion - plain text questions won't work
2. Ask NON-OBVIOUS questions (not "what should it do?" but "how should X handle Y?")
3. Continue until user says "done" or "finalize"
4. Update the draft spec file regularly
5. When finalizing, write to the spec path and output <promise>SPEC COMPLETE</promise>
