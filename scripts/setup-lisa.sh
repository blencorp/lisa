#!/bin/bash

# Lisa Setup Script
# Creates state file and initializes the interview session

set -euo pipefail

# Parse arguments
FEATURE_NAME=""
CONTEXT_FILE=""
OUTPUT_DIR="docs/specs"
MAX_QUESTIONS=0  # Unlimited by default
FIRST_PRINCIPLES=false

while [[ $# -gt 0 ]]; do
  case $1 in
    -h|--help)
      cat << 'HELP_EOF'
Lisa Plan - Interactive specification gathering workflow

Lisa plans. Ralph does.

USAGE:
  /lisa:plan <FEATURE_NAME> [OPTIONS]

ARGUMENTS:
  FEATURE_NAME    Name of the feature to spec out (required)

OPTIONS:
  --context <file>      Initial context file (PRD, requirements, etc.)
  --output-dir <dir>    Output directory for specs (default: docs/specs)
  --max-questions <n>   Maximum question rounds (default: unlimited)
  --first-principles    Challenge assumptions before detailed spec gathering
  -h, --help            Show this help

DESCRIPTION:
  Conducts an in-depth interview to gather requirements and generate
  a comprehensive specification. Questions are adaptive and non-obvious,
  covering technical implementation, UX, trade-offs, and concerns.

  The interview continues until you say "done" or "finalize".

  Use --first-principles to have Lisa challenge your assumptions first,
  helping you arrive at a better solution before diving into details.

EXAMPLES:
  /lisa:plan "user authentication"
  /lisa:plan "payment processing" --context docs/PRD.md
  /lisa:plan "search feature" --output-dir specs/features
  /lisa:plan "new dashboard" --first-principles

OUTPUT:
  Final spec saved to: {output-dir}/{feature-slug}.md
  Structured JSON:     {output-dir}/{feature-slug}.json
  Progress file:       {output-dir}/{feature-slug}-progress.txt
  Draft maintained at: .claude/lisa-draft.md

WORKFLOW:
  1. Lisa plans - Generate spec: /lisa:plan "my feature"
  2. Ralph does - Implement: /ralph-loop

  Lisa plans. Ralph does. Ship faster.
HELP_EOF
      exit 0
      ;;
    --context)
      CONTEXT_FILE="$2"
      shift 2
      ;;
    --output-dir)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --max-questions)
      MAX_QUESTIONS="$2"
      shift 2
      ;;
    --first-principles)
      FIRST_PRINCIPLES=true
      shift
      ;;
    *)
      if [[ -z "$FEATURE_NAME" ]]; then
        FEATURE_NAME="$1"
      else
        FEATURE_NAME="$FEATURE_NAME $1"
      fi
      shift
      ;;
  esac
done

# Validate feature name
if [[ -z "$FEATURE_NAME" ]]; then
  echo "Error: Feature name is required" >&2
  echo "" >&2
  echo "   Example: /lisa:plan \"user authentication\"" >&2
  exit 1
fi

# Create output directory
mkdir -p "$OUTPUT_DIR"
mkdir -p .claude

# Generate slug for filename
FEATURE_SLUG=$(echo "$FEATURE_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd '[:alnum:]-')
SPEC_PATH="$OUTPUT_DIR/$FEATURE_SLUG.md"
JSON_PATH="$OUTPUT_DIR/$FEATURE_SLUG.json"
PROGRESS_PATH="$OUTPUT_DIR/$FEATURE_SLUG-progress.txt"
DRAFT_PATH=".claude/lisa-draft.md"
TIMESTAMP=$(date +%Y-%m-%d)

# Read context file if provided
CONTEXT_CONTENT=""
if [[ -n "$CONTEXT_FILE" ]] && [[ -f "$CONTEXT_FILE" ]]; then
  CONTEXT_CONTENT=$(cat "$CONTEXT_FILE")
fi

# Build the interview prompt - use a temp file to avoid quoting issues
PROMPT_FILE=$(mktemp)

cat > "$PROMPT_FILE" << 'STATIC_PROMPT_EOF'
# Lisa Plan Interview Session

You are conducting a comprehensive specification interview for a feature. Your goal is to gather enough information to write a complete, implementable specification.

## CRITICAL RULES - READ CAREFULLY

### 1. USE AskUserQuestion FOR ALL QUESTIONS
You MUST use the AskUserQuestion tool for every question you ask. Plain text questions will NOT work - the user won't see them. Every question must go through AskUserQuestion.

### 2. ASK NON-OBVIOUS QUESTIONS
DO NOT ask basic clarifying questions like "What should this feature do?" or "Who are the users?"

Instead, ask probing questions like:
- "How should X interact with the existing Y system?"
- "What happens when Z fails? Should we retry, queue, or alert?"
- "Would you prefer approach A (faster but less flexible) or B (more complex but extensible)?"
- "Walk me through the exact flow when a user does X"
- "What are your latency requirements for this operation?"
- "Who should have access to this? What's the authorization model?"

### 3. CONTINUE UNTIL USER SAYS STOP
The interview continues until the user explicitly says "done", "finalize", "finished", or similar. Do NOT stop after one round of questions. After each answer, immediately ask the next question using AskUserQuestion.

### 4. MAINTAIN RUNNING NOTES
After every 2-3 questions, update the draft spec file with accumulated information. This ensures nothing is lost.

### 5. BE ADAPTIVE
Base your next question on previous answers. If the user mentions something interesting, probe deeper. Do not follow a rigid script.

## QUESTION CATEGORIES TO COVER

**Scope Definition:**
- What is explicitly OUT of scope for this implementation?
- What's the MVP vs. full vision? Where do we draw the line?
- Are there related features we should NOT touch?
- What should Ralph ignore even if it seems relevant?

**User Stories (CRITICAL - get this right):**
- Break the feature into discrete user stories (US-1, US-2, etc.)
- Each story MUST be completable in ONE focused coding session
- If a story sounds too big, ask: "Can we break this into smaller stories?"
- For each story, get VERIFIABLE acceptance criteria:
  - BAD: "Works correctly", "Is fast", "Handles errors well"
  - GOOD: "Returns 200 for valid input", "Shows error message for invalid email", "Response < 200ms"
- Ask: "How would you verify this story is complete? What specific test would pass?"

**Technical Implementation:**
- Data models and storage (tables, fields, relationships)
- API design (endpoints, methods, payloads, auth)
- Integration with existing systems
- Error handling and edge cases

**User Experience:**
- User flows and journeys
- Edge cases and error states
- Accessibility considerations
- Mobile vs. desktop differences

**Trade-offs and Concerns:**
- Performance requirements
- Security considerations
- Scalability expectations
- Technical debt concerns

**Implementation Phases:**
- Can this be broken into 2-4 incremental phases?
- What's the logical order of implementation? (foundation first, then core, then polish)
- What can be verified after each phase?
- What's the minimum viable first phase?

**Verification & Feedback Loops:**
- What commands verify the feature works? (test suite, typecheck, build, lint)
- What specific output indicates success vs failure?
- What should Ralph check after each iteration?
- What are the acceptance criteria for each user story? (specific, testable conditions)

## YOUR WORKFLOW

1. Read any provided context
2. Ask your first NON-OBVIOUS question using AskUserQuestion
3. After user responds, update draft spec if you have gathered enough for a section
4. Ask the next question immediately using AskUserQuestion
5. Repeat until user says "done" or "finalize"
6. When user signals completion, write final spec and output <promise>SPEC COMPLETE</promise>
STATIC_PROMPT_EOF

# Add first-principles section if flag is set
if [[ "$FIRST_PRINCIPLES" == "true" ]]; then
  # Create temp file with first-principles content
  FP_TEMP=$(mktemp)
  cat > "$FP_TEMP" << 'FP_EOF'
# Lisa Plan Interview Session

## FIRST PRINCIPLES MODE ACTIVE

You are in first-principles mode. Before gathering detailed spec information, you must challenge and validate the user's approach. This helps ensure we're building the right thing, not just building the thing right.

### PHASE 1: CHALLENGE THE APPROACH (3-5 questions)

Start by asking questions that challenge assumptions. Use AskUserQuestion for each:

1. "What specific problem have you observed that led to this idea?"
2. "What happens if we don't build this at all? What's the cost of inaction?"
3. "What's the absolute simplest thing that might solve this problem?"
4. "What would have to be true for this to be the wrong approach?"
5. "Is there an existing solution (internal, external, or off-the-shelf) we could use instead?"

**IMPORTANT:**
- DO NOT ask implementation questions yet (no API design, no data models, no UX details)
- Focus entirely on validating that this is the RIGHT thing to build
- Listen for signals that the user hasn't fully thought through the problem
- If the user's answers reveal a better approach, help them discover it

### PHASE 2: TRANSITION TO SPEC GATHERING

After 3-5 challenge questions, evaluate the approach:

**If the approach seems valid:**
Tell the user: "The approach seems sound. Let's move to detailed specification."
Then proceed with the standard spec questions (Technical, UX, Scope, Phases, Verification).

**If the approach seems flawed or unclear:**
Help the user discover a better alternative. Ask follow-up questions like:
- "Based on what you've said, would [alternative] actually solve the core problem better?"
- "It sounds like the real issue is [X]. Should we focus on that instead?"

Only proceed to detailed spec gathering once you're confident the approach is valid.

---

FP_EOF

  # Read the rest of the standard prompt (everything after the first header line)
  tail -n +3 "$PROMPT_FILE" >> "$FP_TEMP"
  mv "$FP_TEMP" "$PROMPT_FILE"
fi

# Add context to the prompt if provided
if [[ -n "$CONTEXT_CONTENT" ]]; then
  cat >> "$PROMPT_FILE" << CONTEXT_EOF

## PROVIDED CONTEXT

\`\`\`
$CONTEXT_CONTENT
\`\`\`
CONTEXT_EOF
fi

# Add session info
cat >> "$PROMPT_FILE" << SESSION_EOF

## SESSION INFORMATION

- **Feature:** $FEATURE_NAME
- **Draft File:** $DRAFT_PATH (update this as you gather information)
- **Final Spec:** $SPEC_PATH (write here when user says done)
- **Started:** $TIMESTAMP

---

## BEGIN INTERVIEW NOW

Start by asking your first non-obvious question about "$FEATURE_NAME" using the AskUserQuestion tool. Remember: EVERY question must use AskUserQuestion - plain text questions will not work!
SESSION_EOF

# Read the complete prompt
INTERVIEW_PROMPT=$(cat "$PROMPT_FILE")
rm "$PROMPT_FILE"

# Write state file
cat > .claude/lisa.local.md << STATE_EOF
---
active: true
iteration: 1
max_iterations: $MAX_QUESTIONS
started_at: "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
feature_name: "$FEATURE_NAME"
feature_slug: "$FEATURE_SLUG"
output_dir: "$OUTPUT_DIR"
spec_path: "$SPEC_PATH"
json_path: "$JSON_PATH"
progress_path: "$PROGRESS_PATH"
draft_path: "$DRAFT_PATH"
context_file: "$CONTEXT_FILE"
first_principles: $FIRST_PRINCIPLES
---

$INTERVIEW_PROMPT
STATE_EOF

# Initialize draft spec
cat > "$DRAFT_PATH" << DRAFT_EOF
# Specification Draft: $FEATURE_NAME

*Interview in progress - Started: $TIMESTAMP*

## Overview
[To be filled during interview]

## Problem Statement
[To be filled during interview]

## Scope

### In Scope
<!-- Explicit list of what IS included in this implementation -->
- [To be filled during interview]

### Out of Scope
<!-- Explicit list of what is NOT included - future work, won't fix, etc. -->
- [To be filled during interview]

## User Stories

<!--
IMPORTANT: Each story must be small enough to complete in ONE focused coding session.
If a story is too large, break it into smaller stories.

Format each story with VERIFIABLE acceptance criteria:

### US-1: [Story Title]
**Description:** As a [user type], I want [action] so that [benefit].

**Acceptance Criteria:**
- [ ] [Specific, verifiable criterion - e.g., "API returns 200 for valid input"]
- [ ] [Another verifiable criterion - e.g., "Error message displayed for invalid email"]
- [ ] Typecheck/lint passes
- [ ] [If UI] Verify in browser

BAD criteria (too vague): "Works correctly", "Is fast", "Handles errors"
GOOD criteria: "Response time < 200ms", "Returns 404 for missing resource", "Form shows inline validation"
-->

[To be filled during interview]

## Technical Design

### Data Model
[To be filled during interview]

### API Endpoints
[To be filled during interview]

### Integration Points
[To be filled during interview]

## User Experience

### User Flows
[To be filled during interview]

### Edge Cases
[To be filled during interview]

## Requirements

### Functional Requirements
<!--
Use FR-IDs for each requirement:
- FR-1: [Requirement description]
- FR-2: [Requirement description]
-->
[To be filled during interview]

### Non-Functional Requirements
<!--
Performance, security, scalability requirements:
- NFR-1: [Requirement - e.g., "Response time < 500ms for 95th percentile"]
- NFR-2: [Requirement - e.g., "Support 100 concurrent users"]
-->
[To be filled during interview]

## Implementation Phases

<!-- Break work into 2-4 incremental milestones Ralph can complete one at a time -->

### Phase 1: [Foundation/Setup]
- [ ] [Task 1]
- [ ] [Task 2]
- **Verification:** \`[command to verify phase 1]\`

### Phase 2: [Core Implementation]
- [ ] [Task 1]
- [ ] [Task 2]
- **Verification:** \`[command to verify phase 2]\`

### Phase 3: [Integration/Polish]
- [ ] [Task 1]
- [ ] [Task 2]
- **Verification:** \`[command to verify phase 3]\`

<!-- Add Phase 4 if needed for complex features -->

## Definition of Done

This feature is complete when:
- [ ] All acceptance criteria in user stories pass
- [ ] All implementation phases verified
- [ ] Tests pass: \`[verification command]\`
- [ ] Types/lint check: \`[verification command]\`
- [ ] Build succeeds: \`[verification command]\`

## Ralph Loop Command

<!-- Generated at finalization with phases and escape hatch -->

\`\`\`bash
/ralph-loop "Implement $FEATURE_NAME per spec at $SPEC_PATH

PHASES:
1. [Phase 1 name]: [tasks] - verify with [command]
2. [Phase 2 name]: [tasks] - verify with [command]
3. [Phase 3 name]: [tasks] - verify with [command]

VERIFICATION (run after each phase):
- [test command]
- [lint/typecheck command]
- [build command]

ESCAPE HATCH: After 20 iterations without progress:
- Document what's blocking in the spec file under 'Implementation Notes'
- List approaches attempted
- Stop and ask for human guidance

Output <promise>COMPLETE</promise> when all phases pass verification." --max-iterations 30 --completion-promise "COMPLETE"
\`\`\`

## Open Questions
[To be filled during interview]

## Implementation Notes
[To be filled during interview]

---
*Interview notes will be accumulated below as the interview progresses*
---

DRAFT_EOF

# Output setup message
echo "Lisa Plan - Interview Started"
echo ""
echo "Feature: $FEATURE_NAME"
echo "Draft: $DRAFT_PATH"
echo "Output: $SPEC_PATH"
echo "JSON: $JSON_PATH"
echo "Progress: $PROGRESS_PATH"
if [[ -n "$CONTEXT_FILE" ]]; then
  echo "Context: $CONTEXT_FILE"
fi
if [[ $MAX_QUESTIONS -gt 0 ]]; then
  echo "Max Questions: $MAX_QUESTIONS"
else
  echo "Max Questions: unlimited"
fi
if [[ "$FIRST_PRINCIPLES" == "true" ]]; then
  echo "Mode: First Principles (will challenge assumptions first)"
fi
echo ""
echo "The interview will continue until you say \"done\" or \"finalize\"."
echo "All questions will use the AskUserQuestion tool."
echo ""
echo "Beginning interview..."
echo ""
echo "$INTERVIEW_PROMPT"
