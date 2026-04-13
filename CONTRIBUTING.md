# Contributing to HERO Combat Engine

Thank you for your interest in contributing to the HERO Combat Engine! This document outlines the process for submitting bugfixes, features, and improvements.

## Code of Conduct

Be respectful, constructive, and professional. We welcome contributors of all skill levels.

## Getting Started

### Prerequisites
- Git and GitHub account
- Foundry VTT v11+ installed locally
- A text editor (VS Code recommended)
- Node.js (optional, for linting)

### Setting Up Development Environment

1. **Fork and clone the repository:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/hero-combat-engine.git
   cd hero-combat-engine
   ```

2. **Create a development branch:**
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

3. **Link to your Foundry installation:**
   - Option A: Symlink the module folder into your Foundry `data/modules/` directory
   - Option B: Copy the folder and reload Foundry between changes

4. **Enable the module** in your test world and verify functionality

## Branch Strategy

- **`main`** — Stable, released code. Merge only from `develop` via PR.
- **`develop`** — Active development. All PRs target this branch.
- **`feature/*`** — New features, branch from `develop`
- **`fix/*`** — Bug fixes, branch from `develop`

## Commit Message Format

Use descriptive, conventional commit messages:

```
feat: Add toggle for hiding non-acting tokens
fix: Correct flag cleanup in endCombat function
docs: Update README with troubleshooting section
style: Improve CSS organization
refactor: Extract combatant status logic to helper function
test: Add unit tests for segment calculation
```

Format: `<type>: <subject>`

**Types:**
- `feat` — New feature
- `fix` — Bug fix
- `docs` — Documentation
- `style` — Code style (formatting, missing semicolons, etc.)
- `refactor` — Code restructuring without feature changes
- `perf` — Performance improvements
- `test` — Adding or updating tests
- `chore` — Build, dependencies, tooling

## Code Style

- **JavaScript:** Use consistent indentation (2 spaces), avoid unnecessary console.log
- **CSS:** Follow existing formatting; use CSS variables for colors
- **HTML/HBS:** Keep templates readable; proper nesting and indentation
- **Comments:** Document non-obvious logic; explain the "why", not just the "what"

### Error Handling
- Use `console.error()` for genuine errors that users should see
- Use `heroLog()` in development only; remove before submitting
- Provide user-friendly error messages in chat or notifications

## Submitting Changes

### Before You Submit

1. **Test thoroughly:**
   - Single-player combat
   - Multiplayer session (if applicable)
   - Both GM and player perspectives
   - Edge cases (empty segments, token removal, etc.)

2. **Update documentation:**
   - Update CHANGELOG.md with your changes
   - Update README.md if adding features or changing behavior
   - Add inline comments for complex logic

3. **Check for console errors:**
   - Open browser DevTools (F12)
   - Verify no errors appear during combat execution

4. **Verify no regressions:**
   - Test existing features still work
   - Run any existing test suite if available

### Submitting a Pull Request

1. **Push your branch:**
   ```bash
   git push origin feature/your-feature-name
   ```

2. **Open a PR on GitHub:**
   - Use the PR template (auto-populated)
   - Link related issues with "Closes #123"
   - Provide clear description of changes
   - Add screenshots for UI changes

3. **Respond to review feedback:**
   - Make requested changes promptly
   - Ask questions if guidance is unclear
   - Push changes to the same branch (no new PR needed)

4. **Squash commits if requested:**
   ```bash
   git rebase -i develop
   # Mark all but the first commit as "squash"
   # Update final commit message
   git push origin feature/your-feature-name --force
   ```

## Reporting Bugs

Use the **Bug Report** issue template:
- Include Foundry version, module version, system
- Provide clear steps to reproduce
- Attach error messages or console output
- Mention browser/platform

## Suggesting Features

Use the **Feature Request** issue template:
- Describe the use case and motivation
- Explain the proposed solution
- Consider edge cases and alternatives

## Questions?

Open a discussion or issue on GitHub. We're happy to help!

---

**Thank you for contributing to HERO Combat Engine!**
