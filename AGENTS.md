---
name: backend-patterns
description: Backend development patterns, NestJS architecture, and AI agent behavioral guidelines.
metadata:
  origin: CLAUDE.md adaptation
---

# NestJS Backend Agent Guidelines

Behavioral guidelines to reduce common LLM coding mistakes. Adapted specifically for the NestJS Backend Project.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.
- **Do not care about `.spec.ts` (test) files unless explicitly requested by the user.**

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
` ` `text
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
` ` `

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. NestJS Specific Patterns & Architecture

**Strict adherence to NestJS best practices and project structure.**

### Architecture
- **Controllers:** Keep controllers thin. They should only handle routing, request validation (via DTOs), and response formatting. All business logic must reside in `Services`.
- **Validation:** Use `class-validator` and `class-transformer` in DTOs for request validation. Keep DTOs in a dedicated `dto/` folder within the module.
- **Dependency Injection:** Always use constructor injection for services, repositories, and other dependencies.

### Directory Structure & Responsibilities
- **`src/modules/`:** Code should be grouped logically by feature (e.g., `users`, `conversations`, `messages`, `realtime`, etc.). Do not place feature-specific logic outside of its module.
- **`src/auth/`:** Authentication logic, guards, and strategies must reside here.
- **`src/common/`:** Reusable components like filters, guards, interceptors, and custom decorators should go here.
- **`src/utils/`:** Pure utility functions and helpers that don't depend on NestJS DI container go here.
- **`src/redis/`:** Utilize this module for caching and queue/job-related operations.
- **`src/mail/`:** Delegate all email-sending functionalities to this module.

### Mongoose & Database (MongoDB)
- Use Mongoose for all database interactions.
- Keep database queries in Services. Avoid putting database calls in Controllers.
- Use Mongoose's built-in methods (e.g., `findOne`, `aggregate`) instead of trying to write raw MongoDB commands directly unless absolutely necessary.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
