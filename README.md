# DINASTY

DINASTY is a goal-based AI tool discovery platform for software teams. It combines a curated AI catalog, user-generated project sharing, reviews, admin moderation, and a built-in onboarding agent.

## Prerequisites

- Node.js 20 LTS
- npm

> This project relies on better-sqlite3, which must run on Node 20 for compatibility with the native binary in this repo. Using newer Node versions can fail with an ABI mismatch.

## Setup

1. Copy `.env.example` to `.env`.
2. Update the environment values for your local setup.
3. Install dependencies:

   npm install

4. Start the server:

   npm start

5. Open the app in the browser at:

   http://localhost:3000

## Environment variables

- `PORT`: app port
- `NODE_ENV`: environment name
- `ADMIN_KEY`: admin secret used for protected dashboard routes
- `ANTHROPIC_API_KEY`: API key for the agent chat feature
- `DATABASE_URL`: SQLite database path

## Useful scripts

- `npm run dev` — start with file watching
- `npm test` — run the project test suite

## Main files

- `server.js` — Express API and app entry point
- `db.js` — SQLite database layer
- `script.js` — frontend logic and UI behaviors
- `index.html` — landing page
- `Dashboard.html` — admin dashboard
- `UserDashboard.html` — logged-in user dashboard
