# Backend Agent Rules

Goal: make the smallest correct change.

## Core Rules

- Implement only what was requested.
- Keep changes minimal and localized.
- Follow existing project style, naming, and architecture.
- Do not refactor unrelated code.
- Do not rename files, DTOs, methods, fields, or variables unless required.
- Do not add new abstractions, helpers, logs, comments, caching, or optimizations unless asked.
- Do not modify `.spec.ts` files unless explicitly requested.
- Preserve existing file encoding and Unicode text; do not rewrite Vietnamese strings or other non-ASCII content unless the user explicitly asks for it.
- Ask only when blocked by missing requirements.

## NestJS Rules

- Keep controllers thin.
- Put business logic in services.
- Validate request bodies with DTOs using `class-validator` / `class-transformer`.
- Keep database queries in services.
- Use existing Mongoose patterns in the project.
- Keep feature-specific code inside its module.

## API Safety

Unless explicitly requested, do not change:

- endpoints
- request body shape
- response shape
- status codes
- DTO field names
- existing error format

## Verification

After changes, briefly state:

- what files changed
- what was verified
- what was not verified, if any
