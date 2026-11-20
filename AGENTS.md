# Repository Guidelines

## Project Structure

NetLab is a browser-based network simulator built with Next.js App Router, React, TypeScript, and Tailwind CSS. Routes and layouts live in `src/app/`, including `topology/`, `settings/`, `diagnostics/`, and `lessons/`. Shared UI lives in `src/components/`, with feature folders for the shell, topology, panels, and device emulators. Theme tokens are in `src/app/globals.css`, the favicon is in `src/app/`, and `public/` is available for static assets.

Keep simulation and validation logic in `src/lib/net/`, scenario fixtures and builders in `src/lib/scenarios/`, and lesson setup, checks, and hints in `src/lib/lessons/`. The Zustand store in `src/lib/store.ts` persists scenarios and progress in localStorage. Use its actions for scenario changes so DHCP lease handling stays consistent. Review the store migration when changing persisted data.

## Development Commands

- `pnpm install` installs dependencies using the checked-in lockfile.
- `pnpm dev` starts the development server at `http://localhost:3000`.
- `pnpm lint` runs ESLint with Next.js and TypeScript rules.
- `pnpm test` runs the full Vitest suite once.
- `pnpm build` creates the production build. Run `pnpm start` afterward to serve it locally.

## Coding Style

Use strict TypeScript, two-space indentation, and double quotes. Follow existing naming patterns with PascalCase for React components such as `TopologyView.tsx`, camelCase for functions, and lowercase App Router segments containing `page.tsx`. Reuse Tailwind theme tokens and shared components. Follow the surrounding Japanese UI copy and preserve established networking terms such as DHCP and VLAN.

## Testing

Place Vitest tests beside the code as `*.test.ts`, for example `src/lib/net/simulate.test.ts`. Run a single file with `pnpm test src/lib/net/simulate.test.ts`. For lesson changes, verify that the initial scenario fails at least one check and that the intended fix passes after lease assignment. No coverage threshold is configured.

## Commits and Pull Requests

Git history starts with `Initial commit from Create Next App`. Use short, descriptive commit subjects. In pull requests, explain the behavior change, include validation results, link relevant issues, and attach screenshots for visible UI changes.
