# Contributing to 23plusone Happiness Scan

Thank you for considering contributing to the 23plusone Happiness Scan platform! This document provides guidelines and information to help you contribute effectively.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Project Structure](#project-structure)

---

## Code of Conduct

By participating in this project, you agree to:
- Be respectful and inclusive
- Provide constructive feedback
- Focus on what's best for the community
- Show empathy towards other contributors

---

## Getting Started

### Prerequisites

- Node.js v14 or higher
- PostgreSQL database
- Git
- Basic understanding of HTML, CSS, JavaScript, and Node.js

### Initial Setup

1. **Fork the repository**
   ```bash
   # On GitHub, click "Fork" button
   ```

2. **Clone your fork**
   ```bash
   git clone https://github.com/YOUR_USERNAME/23plusone-scan.git
   cd 23plusone-scan
   ```

3. **Add upstream remote**
   ```bash
   git remote add upstream https://github.com/ORIGINAL_OWNER/23plusone-scan.git
   ```

4. **Install dependencies**
   ```bash
   # Root dependencies (Tailwind)
   npm install
   
   # Server dependencies
   cd server
   npm install
   ```

5. **Set up environment**
   ```bash
   cd server
   cp .env.example .env
   # Edit .env with your database credentials
   ```

6. **Initialize database**
   ```bash
   createdb happiness_benchmark
   psql happiness_benchmark -f ../db/schema.sql
   ```

7. **Start development**
   ```bash
   # Terminal 1: CSS watch mode
   npm run build:css
   
   # Terminal 2: Frontend dev server
   npm run dev
   
   # Terminal 3: Backend server
   cd server && node server.js
   ```

---

## Development Workflow

### 1. Create a Feature Branch

Always create a new branch for your work:

```bash
# Update main branch
git checkout main
git pull upstream main

# Create feature branch
git checkout -b feature/your-feature-name
# Or for bug fixes:
git checkout -b fix/bug-description
```

**Branch naming conventions:**
- `feature/` - New features
- `fix/` - Bug fixes
- `refactor/` - Code refactoring
- `docs/` - Documentation changes
- `style/` - CSS/styling changes
- `test/` - Test additions or changes

### 2. Make Your Changes

**Keep changes focused:**
- One feature/fix per branch
- Small, reviewable pull requests
- Add tests if applicable
- Update documentation if needed

**File organization:**
- Frontend code: `/public/`
- Backend code: `/server/`
- Documentation: `/docs/`
- Database: `/db/`

### 3. Test Your Changes

Before committing:
- ✅ Test in browser (Chrome, Safari, Firefox)
- ✅ Test mobile responsiveness
- ✅ Check console for errors
- ✅ Verify no broken links or 404s
- ✅ Test backend API endpoints
- ✅ Verify database queries work

### 4. Commit Your Changes

```bash
git add .
git commit -m "feat: add card shuffle feature"
```

See [Commit Message Guidelines](#commit-message-guidelines) below.

### 5. Push and Create PR

```bash
git push origin feature/your-feature-name
```

Then create a Pull Request on GitHub.

---

## Pull Request Process

### 1. **Before Submitting**

- [ ] Code follows project style guidelines
- [ ] Changes are tested locally
- [ ] Documentation is updated
- [ ] Commit messages follow conventions
- [ ] No merge conflicts with main
- [ ] PR description explains changes

### 2. **PR Title Format**

Use the same format as commit messages:

```
feat: add email validation to report form
fix: correct timer calculation on mobile Safari
docs: update API documentation with error codes
```

### 3. **PR Description Template**

```markdown
## Description
Brief description of what this PR does.

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Refactoring
- [ ] Documentation
- [ ] Other (please describe)

## Changes Made
- List specific changes
- Be as detailed as needed

## Testing Done
- [ ] Tested on Chrome/Firefox/Safari
- [ ] Tested on mobile devices
- [ ] Backend tests passing
- [ ] No console errors

## Screenshots (if applicable)
Add screenshots for UI changes

## Related Issues
Fixes #123
Relates to #456
```

### 4. **Review Process**

- Maintainers will review your PR
- Address any feedback or requested changes
- Once approved, PR will be merged
- Delete your feature branch after merge

---

## Coding Standards

### JavaScript

**Style:**
- Use ES6+ features (const, let, arrow functions)
- Use camelCase for variables and functions
- Use PascalCase for classes
- Add comments for complex logic
- Keep functions small and focused

**Example:**
```javascript
// Good
const calculateScore = (responses) => {
  const totalYes = responses.filter(r => r.yes).length;
  return (totalYes / responses.length) * 100;
};

// Avoid
function calc(r) {
  var t = 0;
  for(var i=0;i<r.length;i++) if(r[i].yes) t++;
  return t/r.length*100;
}
```

### CSS

**Organization:**
- Follow the existing modular structure
- Use CSS variables from `base.css`
- Mobile-first responsive design
- Use semantic class names

**Example:**
```css
/* Good - Uses CSS variables and semantic naming */
.btn-primary {
  background-color: var(--brand-pink);
  padding: var(--spacing-md);
  border-radius: 8px;
}

/* Avoid - Magic numbers and hardcoded values */
.btn1 {
  background-color: #e91e63;
  padding: 16px;
  border-radius: 8px;
}
```

### HTML

**Structure:**
- Semantic HTML5 elements
- Proper ARIA attributes for accessibility
- Descriptive alt text for images
- Relative paths for assets

**Example:**
```html
<!-- Good -->
<button 
  id="startBtn" 
  type="button" 
  class="btn-pill" 
  aria-label="Start happiness scan">
  Start Scan
</button>

<!-- Avoid -->
<div onclick="start()" class="btn">Start</div>
```

### File Organization

**When adding files:**
- Assets → `public/assets/icons/`, `public/assets/logos/`, or `public/assets/images/`
- Scripts → `public/scripts/` (or `public/scripts/app/` for modular scan code)
- Styles → `public/styles/`
- Documentation → `docs/`
- Backend routes → `server/routes/`
- Backend utilities → `server/lib/`

---

## Commit Message Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/) specification.

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation changes
- **style**: Code style changes (formatting, no logic change)
- **refactor**: Code refactoring
- **test**: Adding or updating tests
- **chore**: Maintenance tasks

### Examples

```bash
# Simple feature
git commit -m "feat: add email validation to report form"

# Bug fix with description
git commit -m "fix: correct timer calculation on Safari

The timer was not accounting for viewport changes on mobile Safari.
Added viewport resize listener to update timer display."

# Documentation
git commit -m "docs: update API documentation with error responses"

# Multiple changes
git commit -m "refactor: reorganize asset structure

- Move images to assets/images/
- Update all HTML references
- Add PROJECT_STRUCTURE.md
- Update ASSETS.md with new paths"
```

### Scope (Optional)

Add scope for context:
```bash
feat(scan): add shuffle cards option
fix(api): correct benchmark calculation
docs(readme): add troubleshooting section
```

---

## Project Structure

Key directories to know:

```
23plusone-scan/
├── docs/              # All documentation
├── public/            # Frontend static files
│   ├── assets/        # Images, icons, logos
│   ├── data/          # JSON data files
│   ├── scripts/       # JavaScript
│   ├── styles/        # CSS
│   └── *.html         # HTML pages
├── server/            # Backend Express.js app
│   ├── routes/        # API routes
│   └── lib/           # Utilities
└── db/                # Database schemas
```

See `/docs/PROJECT_STRUCTURE.md` for complete details.

---

## Questions?

- **Documentation**: Check `/docs/` folder first
- **Issues**: Open a GitHub issue
- **Discussions**: Use GitHub Discussions
- **Quick questions**: Add comment to relevant issue/PR

---

## Recognition

Contributors will be:
- Listed in project credits
- Mentioned in release notes
- Thanked in the community

Thank you for contributing! 🎉
