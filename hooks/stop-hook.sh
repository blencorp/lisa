#!/bin/bash

# Lisa Stop Hook
# Prevents session exit when a Lisa interview is active
# Continues the interview until user says "done" or "finalize"

set -uo pipefail

# Cleanup trap for graceful error handling
cleanup_on_error() {
    local exit_code=$?
    if [[ $exit_code -ne 0 ]]; then
        echo "Warning: Lisa stop hook error (code: $exit_code)" >&2
        # Clean up state file to prevent error loops
        rm -f ".claude/lisa.local.md" 2>/dev/null
    fi
    exit 0
}
trap cleanup_on_error EXIT

# Read hook input from stdin
HOOK_INPUT=$(cat)

# State file location
STATE_FILE=".claude/lisa.local.md"

if [[ ! -f "$STATE_FILE" ]]; then
  # No active interview - allow exit
  exit 0
fi

# Parse markdown frontmatter (YAML between ---) and extract values
FRONTMATTER=$(sed -n '/^---$/,/^---$/{ /^---$/d; p; }' "$STATE_FILE")
ITERATION=$(echo "$FRONTMATTER" | grep '^iteration:' | sed 's/iteration: *//')
MAX_ITERATIONS=$(echo "$FRONTMATTER" | grep '^max_iterations:' | sed 's/max_iterations: *//')
FEATURE_NAME=$(echo "$FRONTMATTER" | grep '^feature_name:' | sed 's/feature_name: *//' | sed 's/^"\(.*\)"$/\1/')
SPEC_PATH=$(echo "$FRONTMATTER" | grep '^spec_path:' | sed 's/spec_path: *//' | sed 's/^"\(.*\)"$/\1/')
JSON_PATH=$(echo "$FRONTMATTER" | grep '^json_path:' | sed 's/json_path: *//' | sed 's/^"\(.*\)"$/\1/')
PROGRESS_PATH=$(echo "$FRONTMATTER" | grep '^progress_path:' | sed 's/progress_path: *//' | sed 's/^"\(.*\)"$/\1/')
DRAFT_PATH=$(echo "$FRONTMATTER" | grep '^draft_path:' | sed 's/draft_path: *//' | sed 's/^"\(.*\)"$/\1/')

# Validate iteration
if [[ ! "$ITERATION" =~ ^[0-9]+$ ]]; then
  echo "Warning: Lisa state file corrupted (invalid iteration)" >&2
  rm -f "$STATE_FILE"
  exit 0
fi

# Check max iterations (if set and > 0)
if [[ "$MAX_ITERATIONS" =~ ^[0-9]+$ ]] && [[ $MAX_ITERATIONS -gt 0 ]] && [[ $ITERATION -ge $MAX_ITERATIONS ]]; then
  echo "Lisa: Max questions ($MAX_ITERATIONS) reached."
  echo "   Draft spec saved at: $DRAFT_PATH"
  echo "   Run /finalize-spec to complete, or continue manually."
  rm -f "$STATE_FILE"
  exit 0
fi

# Validate HOOK_INPUT is not empty
if [[ -z "$HOOK_INPUT" ]]; then
    echo "Warning: Lisa hook received empty input" >&2
    rm -f "$STATE_FILE"
    exit 0
fi

# Validate JSON structure
if ! echo "$HOOK_INPUT" | jq -e '.' >/dev/null 2>&1; then
    echo "Warning: Lisa hook received malformed JSON" >&2
    rm -f "$STATE_FILE"
    exit 0
fi

# Get transcript path from hook input (with safe extraction)
TRANSCRIPT_PATH=$(echo "$HOOK_INPUT" | jq -r '.transcript_path // empty' 2>/dev/null || echo "")

if [[ -z "$TRANSCRIPT_PATH" ]] || [[ "$TRANSCRIPT_PATH" == "null" ]]; then
    echo "Warning: Lisa hook missing transcript_path" >&2
    rm -f "$STATE_FILE"
    exit 0
fi

if [[ ! -f "$TRANSCRIPT_PATH" ]]; then
  echo "Warning: Lisa transcript not found" >&2
  rm -f "$STATE_FILE"
  exit 0
fi

# Check if there are any assistant messages
if ! grep -q '"role":"assistant"' "$TRANSCRIPT_PATH" 2>/dev/null; then
  echo "Warning: No assistant messages found in transcript" >&2
  rm -f "$STATE_FILE"
  exit 0
fi

# Extract last assistant message
LAST_LINE=$(grep '"role":"assistant"' "$TRANSCRIPT_PATH" | tail -1)
LAST_OUTPUT=$(echo "$LAST_LINE" | jq -r '
  .message.content |
  map(select(.type == "text")) |
  map(.text) |
  join("\n")
' 2>/dev/null || echo "")

# Check for completion promise (<promise>SPEC COMPLETE</promise>)
PROMISE_TEXT=$(echo "$LAST_OUTPUT" | perl -0777 -pe 's/.*?<promise>(.*?)<\/promise>.*/$1/s; s/^\s+|\s+$//g; s/\s+/ /g' 2>/dev/null || echo "")

if [[ -n "$PROMISE_TEXT" ]] && [[ "$PROMISE_TEXT" = "SPEC COMPLETE" ]]; then
  echo "Lisa interview complete!"
  echo "   Final spec saved to: $SPEC_PATH"
  echo "   Structured JSON:     $JSON_PATH"
  echo "   Progress file:       $PROGRESS_PATH"
  rm -f "$STATE_FILE"
  exit 0
fi

# Check if user said "done" or "finalize" in the most recent user message
# We need to look at user messages in the transcript
USER_MESSAGES=$(grep '"role":"user"' "$TRANSCRIPT_PATH" | tail -1 || echo "")
if [[ -n "$USER_MESSAGES" ]]; then
  USER_TEXT=$(echo "$USER_MESSAGES" | jq -r '
    .message.content |
    if type == "array" then
      map(select(.type == "text")) | map(.text) | join("\n")
    elif type == "string" then
      .
    else
      ""
    end
  ' 2>/dev/null || echo "")

  # Check for completion signals (case-insensitive)
  if echo "$USER_TEXT" | grep -iqE '\b(done|finalize|finished|that.?s all|complete|wrap up)\b'; then
    # User wants to finalize - inject finalization prompt
    NEXT_ITERATION=$((ITERATION + 1))

    # Update iteration in state file
    TEMP_FILE="${STATE_FILE}.tmp.$$"
    if ! sed "s/^iteration: .*/iteration: $NEXT_ITERATION/" "$STATE_FILE" > "$TEMP_FILE" 2>/dev/null; then
        echo "Warning: Failed to update state file" >&2
        rm -f "$TEMP_FILE" "$STATE_FILE"
        exit 0
    fi
    mv "$TEMP_FILE" "$STATE_FILE"

    FINALIZE_PROMPT="CRITICAL: You are writing DOCUMENTATION files only. Do NOT write any source code, implementation files, or execute any commands. Your ONLY task is to create three text files.

The user has indicated they want to finalize the specification.

YOUR TASK: Create exactly 3 documentation files. Nothing else.

═══════════════════════════════════════════════════════════════════════════════
FILE 1: PRD Specification ($SPEC_PATH)
═══════════════════════════════════════════════════════════════════════════════

Read the draft at '$DRAFT_PATH', then write a polished PRD with these sections:

## User Stories
Each story MUST have:
- ID format: ### US-1: [Title], ### US-2: [Title], etc.
- Description: As a [user], I want [action] so that [benefit].
- Acceptance Criteria: VERIFIABLE checklist items
  - GOOD: 'API returns 200 for valid input', 'Form shows error for invalid email'
  - BAD: 'Works correctly', 'Is fast', 'Handles errors'

## Functional Requirements
Use IDs: FR-1, FR-2, FR-3, etc.

## Non-Functional Requirements
Use IDs: NFR-1, NFR-2, etc.

## Scope
- In Scope: [list]
- Out of Scope: [list]

## Implementation Phases
Document the suggested phases with their verification commands (as text).

## Definition of Done
Checklist for when the feature is complete.

## Ralph Loop Command
This section contains the TEXT of a command that a developer would copy-paste later.
Write it as a markdown code block. Example format:

\`\`\`
claude --max-iterations 30 --completion-promise \"COMPLETE\" \"Implement the spec at $SPEC_PATH following the phases defined. After each phase, run verification. If stuck for 20 iterations, document blockers and ask for help.\"
\`\`\`

═══════════════════════════════════════════════════════════════════════════════
FILE 2: Test Cases JSON ($JSON_PATH)
═══════════════════════════════════════════════════════════════════════════════

Generate a JSON array. Each element MUST have ALL these fields:
[
  {
    \"category\": \"functional\",
    \"description\": \"[what this test verifies]\",
    \"steps\": [\"step 1\", \"step 2\", \"step 3\"],
    \"passes\": false
  }
]

- \"category\": One of \"functional\", \"setup\", \"integration\", \"ui\", \"error-handling\"
- \"description\": Clear description of what this test case verifies
- \"steps\": Array of verification steps (strings)
- \"passes\": MUST always be false (will be updated during implementation)

Generate one test case for each user story or acceptance criterion.

═══════════════════════════════════════════════════════════════════════════════
FILE 3: Empty Progress File ($PROGRESS_PATH)
═══════════════════════════════════════════════════════════════════════════════

Create an EMPTY file with no content. Just create the file.

═══════════════════════════════════════════════════════════════════════════════
IMPORTANT CONSTRAINTS
═══════════════════════════════════════════════════════════════════════════════

- Do NOT create or modify any source code files (.ts, .js, .py, .tsx, .jsx, etc.)
- Do NOT run any implementation commands
- Do NOT start the Ralph loop or any other automation
- Do NOT execute the Ralph Loop Command - just write it as documentation text
- ONLY create the three documentation files listed above

After writing all three files, output: <promise>SPEC COMPLETE</promise>"

    jq -n \
      --arg prompt "$FINALIZE_PROMPT" \
      --arg msg "User requested finalization - generating final spec..." \
      '{
        "decision": "block",
        "reason": $prompt,
        "systemMessage": $msg
      }'
    exit 0
  fi
fi

# Continue interview - inject the continuation prompt
NEXT_ITERATION=$((ITERATION + 1))

# Update iteration in state file
TEMP_FILE="${STATE_FILE}.tmp.$$"
if ! sed "s/^iteration: .*/iteration: $NEXT_ITERATION/" "$STATE_FILE" > "$TEMP_FILE" 2>/dev/null; then
    echo "Warning: Failed to update state file" >&2
    rm -f "$TEMP_FILE" "$STATE_FILE"
    exit 0
fi
mv "$TEMP_FILE" "$STATE_FILE"

# Extract the interview prompt from state file (everything after second ---)
PROMPT_TEXT=$(awk '/^---$/{i++; next} i>=2' "$STATE_FILE")

if [[ -z "$PROMPT_TEXT" ]]; then
  echo "Warning: No prompt found in state file" >&2
  rm -f "$STATE_FILE"
  exit 0
fi

# Build system message with iteration count
SYSTEM_MSG="Lisa round $NEXT_ITERATION | Continue asking questions until user says 'done' or 'finalize'"

# Output JSON to block the stop and feed prompt back
jq -n \
  --arg prompt "$PROMPT_TEXT" \
  --arg msg "$SYSTEM_MSG" \
  '{
    "decision": "block",
    "reason": $prompt,
    "systemMessage": $msg
  }'

exit 0
