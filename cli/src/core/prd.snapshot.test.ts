/**
 * Snapshot tests for PRD (Product Requirements Document) output formats
 *
 * These tests ensure consistent output formatting for both markdown and JSON PRD files.
 * When output format changes, snapshots must be intentionally updated using:
 *   npm run test -- --update
 *
 * IMPORTANT: Review snapshot changes carefully before committing to ensure
 * formatting changes are intentional and improve the output.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generateMarkdown,
  generateJSON,
  formatUserStory,
  type PRDData,
  type UserStory,
} from './prd.js';

describe('PRD Snapshot Tests', () => {
  // Mock Date to ensure consistent timestamps in snapshots
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T10:30:00.000Z'));
  });

  // Simple PRD fixture
  const simpleUserStory: UserStory = {
    title: 'User Login',
    description: 'As a user, I want to log in to my account so that I can access my data',
    acceptanceCriteria: [
      'User can enter email and password',
      'Invalid credentials show error message',
    ],
  };

  const simplePRD: PRDData = {
    overview: 'This feature implements basic user authentication for the application.',
    userStories: [simpleUserStory],
    technicalNotes: 'Use bcrypt for password hashing. Implement rate limiting on login endpoint.',
  };

  // Complex PRD fixture with multiple stories
  const complexPRD: PRDData = {
    overview: `This feature implements a comprehensive user management system including authentication, authorization, and profile management.

Key capabilities include:
- Secure password-based authentication
- Role-based access control (RBAC)
- User profile management
- Session management with refresh tokens`,
    userStories: [
      {
        title: 'User Registration',
        description: 'As a new user, I want to create an account so that I can access the application',
        acceptanceCriteria: [
          'User can enter name, email, and password',
          'Email validation ensures proper format',
          'Password requirements enforced (min 8 chars, 1 number, 1 special char)',
          'Duplicate email detection prevents re-registration',
          'Welcome email sent upon successful registration',
        ],
      },
      {
        title: 'User Login',
        description: 'As a registered user, I want to log in securely so that I can access my data',
        acceptanceCriteria: [
          'User can authenticate with email and password',
          'Failed attempts are rate-limited',
          'JWT tokens issued upon successful login',
          'Refresh token enables session extension',
        ],
      },
      {
        title: 'Password Reset',
        description: 'As a user who forgot my password, I want to reset it so that I can regain access',
        acceptanceCriteria: [
          'User can request password reset via email',
          'Reset link expires after 1 hour',
          'New password must meet security requirements',
          'Old sessions invalidated after password change',
        ],
      },
      {
        title: 'Profile Management',
        description: 'As a user, I want to manage my profile information so that I can keep it up to date',
        acceptanceCriteria: [
          'User can view current profile information',
          'User can update name and email',
          'Email changes require verification',
          'Profile picture upload supported',
        ],
      },
    ],
    technicalNotes: `## Authentication Architecture

### Token Strategy
- Access tokens: JWT with 15-minute expiry
- Refresh tokens: Opaque tokens with 7-day expiry
- Tokens stored in HTTP-only cookies for XSS protection

### Security Considerations
- Passwords hashed with bcrypt (cost factor 12)
- Rate limiting: 5 failed attempts triggers 15-minute lockout
- CSRF protection via double-submit cookie pattern

### Database Schema
- Users table with email, password_hash, created_at, updated_at
- Sessions table for refresh token management
- Password reset tokens with expiration tracking

### API Endpoints
\`\`\`
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
POST /api/auth/refresh
POST /api/auth/forgot-password
POST /api/auth/reset-password
GET  /api/users/me
PUT  /api/users/me
\`\`\``,
  };

  // Edge case: PRD with minimal content
  const minimalPRD: PRDData = {
    overview: 'A simple feature.',
    userStories: [
      {
        title: 'Basic Task',
        description: 'As a user, I want to do something',
        acceptanceCriteria: [],
      },
    ],
    technicalNotes: '',
  };

  // Edge case: PRD with special characters
  const specialCharsPRD: PRDData = {
    overview: 'Feature with "quotes", <tags>, & ampersands, and `code`.',
    userStories: [
      {
        title: 'Handle Special Characters',
        description: 'As a user, I want to input text with special chars like <script>, "quotes", and & symbols',
        acceptanceCriteria: [
          'Input sanitized for <script> tags',
          'Quotes "single" and \'double\' handled correctly',
          'Ampersands & other HTML entities escaped',
          'Backticks `code` rendered properly',
        ],
      },
    ],
    technicalNotes: 'Use DOMPurify for sanitization. Escape HTML entities: &lt; &gt; &amp; &quot;',
  };

  describe('Markdown Output Snapshots', () => {
    describe('formatUserStory', () => {
      it('matches snapshot for simple user story', () => {
        const result = formatUserStory(simpleUserStory, 0);
        expect(result).toMatchSnapshot();
      });

      it('matches snapshot for user story with many acceptance criteria', () => {
        const result = formatUserStory(complexPRD.userStories[0], 0);
        expect(result).toMatchSnapshot();
      });

      it('matches snapshot for user story with no acceptance criteria', () => {
        const result = formatUserStory(minimalPRD.userStories[0], 0);
        expect(result).toMatchSnapshot();
      });

      it('matches snapshot for user story with special characters', () => {
        const result = formatUserStory(specialCharsPRD.userStories[0], 0);
        expect(result).toMatchSnapshot();
      });

      it('matches snapshot with different index numbers', () => {
        const story: UserStory = {
          title: 'Third Story',
          description: 'This is the third story',
          acceptanceCriteria: ['Criterion A', 'Criterion B'],
        };
        const result = formatUserStory(story, 2); // 0-indexed, displays as "3."
        expect(result).toMatchSnapshot();
      });
    });

    describe('generateMarkdown', () => {
      it('matches snapshot for simple PRD', () => {
        const result = generateMarkdown(simplePRD, 'user-auth');
        expect(result).toMatchSnapshot();
      });

      it('matches snapshot for complex PRD with multiple stories', () => {
        const result = generateMarkdown(complexPRD, 'user-management-system');
        expect(result).toMatchSnapshot();
      });

      it('matches snapshot for minimal PRD', () => {
        const result = generateMarkdown(minimalPRD, 'minimal-feature');
        expect(result).toMatchSnapshot();
      });

      it('matches snapshot for PRD with special characters', () => {
        const result = generateMarkdown(specialCharsPRD, 'special-chars');
        expect(result).toMatchSnapshot();
      });

      it('matches snapshot with custom feature name', () => {
        const result = generateMarkdown(simplePRD, 'user-auth', 'User Authentication System');
        expect(result).toMatchSnapshot();
      });

      it('matches snapshot for title generated from hyphenated slug', () => {
        const result = generateMarkdown(simplePRD, 'my-awesome-feature-v2');
        expect(result).toMatchSnapshot();
      });
    });
  });

  describe('JSON Output Snapshots', () => {
    describe('generateJSON', () => {
      it('matches snapshot for simple PRD', () => {
        const result = generateJSON(simplePRD, 'user-auth');
        expect(result).toMatchSnapshot();
      });

      it('matches snapshot for complex PRD with multiple stories', () => {
        const result = generateJSON(complexPRD, 'user-management-system');
        expect(result).toMatchSnapshot();
      });

      it('matches snapshot for minimal PRD', () => {
        const result = generateJSON(minimalPRD, 'minimal-feature');
        expect(result).toMatchSnapshot();
      });

      it('matches snapshot for PRD with special characters', () => {
        const result = generateJSON(specialCharsPRD, 'special-chars');
        expect(result).toMatchSnapshot();
      });

      it('matches snapshot with custom feature name', () => {
        const result = generateJSON(simplePRD, 'user-auth', 'User Authentication System');
        expect(result).toMatchSnapshot();
      });

      it('matches snapshot for JSON structure with nested acceptance criteria', () => {
        const result = generateJSON(complexPRD, 'complex-feature');
        // Specifically verify the nested structure matches expectations
        expect(result.userStories.map(s => ({
          id: s.id,
          title: s.title,
          criteriaCount: s.acceptanceCriteria.length,
        }))).toMatchSnapshot();
      });
    });

    describe('JSON stringified output', () => {
      it('matches snapshot for pretty-printed JSON output', () => {
        const json = generateJSON(simplePRD, 'user-auth');
        const stringified = JSON.stringify(json, null, 2);
        expect(stringified).toMatchSnapshot();
      });

      it('matches snapshot for complex JSON stringified output', () => {
        const json = generateJSON(complexPRD, 'user-management-system');
        const stringified = JSON.stringify(json, null, 2);
        expect(stringified).toMatchSnapshot();
      });
    });
  });

  describe('Output Consistency', () => {
    it('markdown and JSON have matching content', () => {
      const markdown = generateMarkdown(simplePRD, 'test-feature', 'Test Feature');
      const json = generateJSON(simplePRD, 'test-feature', 'Test Feature');

      // Verify that the title appears in both outputs
      expect(markdown).toContain('# Test Feature');
      expect(json.metadata.title).toBe('Test Feature');

      // Verify that overview content matches
      expect(markdown).toContain(simplePRD.overview);
      expect(json.overview).toBe(simplePRD.overview);

      // Verify that user story titles appear in both
      expect(markdown).toContain(simpleUserStory.title);
      expect(json.userStories[0].title).toBe(simpleUserStory.title);

      // Verify acceptance criteria count matches
      expect(json.userStories[0].acceptanceCriteria.length).toBe(
        simpleUserStory.acceptanceCriteria.length
      );

      // Verify technical notes content matches
      expect(markdown).toContain(simplePRD.technicalNotes);
      expect(json.technicalNotes).toBe(simplePRD.technicalNotes);
    });

    it('JSON acceptance criteria text matches markdown checkboxes', () => {
      const markdown = generateMarkdown(simplePRD, 'test');
      const json = generateJSON(simplePRD, 'test');

      // Each acceptance criterion in JSON should appear as a checkbox in markdown
      for (const criterion of json.userStories[0].acceptanceCriteria) {
        expect(markdown).toContain(`- [ ] ${criterion.text}`);
      }
    });
  });
});
