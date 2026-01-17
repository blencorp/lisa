#!/bin/bash

# Lisa Stop Hook
# Prevents session exit when a Lisa interview is active
# Continues the interview until user says "done" or "finalize"

set -euo pipefail

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
  rm "$STATE_FILE"
  exit 0
fi

# Check max iterations (if set and > 0)
if [[ "$MAX_ITERATIONS" =~ ^[0-9]+$ ]] && [[ $MAX_ITERATIONS -gt 0 ]] && [[ $ITERATION -ge $MAX_ITERATIONS ]]; then
  echo "Lisa: Max questions ($MAX_ITERATIONS) reached."
  echo "   Draft spec saved at: $DRAFT_PATH"
  echo "   Run /finalize-spec to complete, or continue manually."
  rm "$STATE_FILE"
  exit 0
fi

# Get transcript path from hook input
TRANSCRIPT_PATH=$(echo "$HOOK_INPUT" | jq -r '.transcript_path')

if [[ ! -f "$TRANSCRIPT_PATH" ]]; then
  echo "Warning: Lisa transcript not found" >&2
  rm "$STATE_FILE"
  exit 0
fi

# Check if there are any assistant messages
if ! grep -q '"role":"assistant"' "$TRANSCRIPT_PATH"; then
  echo "Warning: No assistant messages found in transcript" >&2
  rm "$STATE_FILE"
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
  rm "$STATE_FILE"
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
    sed "s/^iteration: .*/iteration: $NEXT_ITERATION/" "$STATE_FILE" > "$TEMP_FILE"
    mv "$TEMP_FILE" "$STATE_FILE"

    FINALIZE_PROMPT="The user has indicated they want to finalize the specification.

FINALIZATION INSTRUCTIONS:
1. Read the draft spec file at '$DRAFT_PATH' to see all accumulated information

2. Write the final, polished PRD to '$SPEC_PATH' following this EXACT format:

   ## User Stories (REQUIRED FORMAT)
   Each story MUST have:
   - ID: ### US-1: [Title], ### US-2: [Title], etc.
   - Description: As a [user], I want [action] so that [benefit].
   - Acceptance Criteria: VERIFIABLE checklist (not vague)
     - GOOD: 'API returns 200 for valid input', 'Form shows error for invalid email'
     - BAD: 'Works correctly', 'Is fast', 'Handles errors'
   - Each story must be completable in ONE focused coding session

   ## Functional Requirements
   Use FR-IDs: FR-1, FR-2, FR-3, etc.

   ## Non-Functional Requirements
   Use NFR-IDs: NFR-1, NFR-2, etc.

   ## Other Required Sections
   - Scope (In Scope / Out of Scope)
   - Implementation Phases with verification commands
   - Definition of Done
   - Ralph Loop Command

3. The Ralph Loop command MUST include:
   - Reference the spec path: $SPEC_PATH
   - PHASES section listing each phase with tasks and verification command
   - VERIFICATION section with test/lint/build commands to run after each phase
   - ESCAPE HATCH section: 'After 20 iterations without progress: Document what's blocking in the spec file under Implementation Notes, list approaches attempted, stop and ask for human guidance'
   - Use --max-iterations 30 --completion-promise \"COMPLETE\"

4. Generate '$JSON_PATH' as a JSON array where each element follows this EXACT structure (ALL fields are REQUIRED):
   [
     {
       \"category\": \"functional\",
       \"description\": \"[specific test case description]\",
       \"steps\": [
         \"[step 1 to verify]\",
         \"[step 2 to verify]\",
         \"[step 3 to verify]\"
       ],
       \"passes\": false
     }
   ]

   REQUIRED FIELDS (all must be present):
   - \"category\": One of \"functional\", \"setup\", \"integration\", \"ui\", \"error-handling\"
   - \"description\": Clear description of what this test case verifies
   - \"steps\": Array of verification steps (strings)
   - \"passes\": MUST always be false (Ralph will update during implementation)

   Generate one test case object for each user story or acceptance criterion from the PRD.

5. Create an EMPTY file at '$PROGRESS_PATH' - the file MUST be empty with no content (Ralph will populate it during implementation)

6. After writing all three files, output: <promise>SPEC COMPLETE</promise>

Do this now - write the final spec (.md), structured JSON (.json), create the empty progress file (.txt), and output the completion promise."

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
sed "s/^iteration: .*/iteration: $NEXT_ITERATION/" "$STATE_FILE" > "$TEMP_FILE"
mv "$TEMP_FILE" "$STATE_FILE"

# Extract the interview prompt from state file (everything after second ---)
PROMPT_TEXT=$(awk '/^---$/{i++; next} i>=2' "$STATE_FILE")

if [[ -z "$PROMPT_TEXT" ]]; then
  echo "Warning: No prompt found in state file" >&2
  rm "$STATE_FILE"
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
