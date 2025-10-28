# AGENTS.MD - AI Agent Collaboration Guide for ai-floorplans

## Overview

This document outlines the roles, responsibilities, tools, and potential workflows for AI agents collaborating on the `ai-floorplans` project. The goal is to facilitate autonomous or semi-autonomous development, testing, deployment, and operation of the React Planner application and its supporting infrastructure.

The project consists of:

1.  **`react-planner` library:** The core floor planning component (source in `/src`, built outputs in `/lib`, `/es`).
2.  **`demo` application:** A React web application showcasing `react-planner` (source in `/demo/src`, built output in `/demo/dist`).
3.  **`cloudflare-planner`:** Backend infrastructure using Cloudflare Workers (gateway, API logic) and a containerized service (Node.js/Express for serving the demo app). Includes an agent API endpoint (`/api/agent/`).

Agents are expected to leverage the shared `colby` CLI ecosystem and toolbox where applicable, potentially collaborating via frameworks like CrewAI or LangGraph. Autonomous execution via `codex --approval-mode full-auto` is anticipated for infrastructure tasks.

## Agent Roles

### 1. DevOps Agent (`ops-agent`)

* **Goal:** Manage the deployment, health, and infrastructure of the Cloudflare-based backend and frontend hosting.
* **Key Responsibilities:**
    * Deploy Cloudflare Worker using Wrangler (`wrangler deploy`).
    * Build and deploy the container service (e.g., using `docker build`, `docker push`, potentially Cloudflare Pages/Workers integrations).
    * Configure `wrangler.toml`, including secrets, bindings (`RENDERER_SERVICE`), and Durable Objects (`AGENT_OBJECT`).
    * Manage environment variables (`.dev.vars`, `.env.template`).
    * Monitor application health via the `/health` endpoint and Cloudflare logs (`wrangler tail`).
    * Execute deployment scripts (`cloudflare-planner/deploy.sh`).
    * Troubleshoot deployment and runtime issues related to Cloudflare or container orchestration.
* **Primary Tools/Context:**
    * Commands: `wrangler`, `docker`, `docker-compose`, `git`, `sh`
    * Files: `cloudflare-planner/worker/wrangler.toml`, `cloudflare-planner/container/Dockerfile`, `cloudflare-planner/docker-compose.yml`, `cloudflare-planner/deploy.sh`, `.dev.vars`, `.env.template`
    * Cloudflare Dashboard (for logs, settings)
* **Interactions:** Collaborates with `backend-agent` and `frontend-agent` on deployment requirements and troubleshooting.

### 2. Frontend Agent (`frontend-agent`)

* **Goal:** Develop, maintain, and build the `demo` React application.
* **Key Responsibilities:**
    * Implement new features or fix bugs within the `demo` application (`/demo/src`).
    * Integrate features or updates from the `react-planner` library.
    * Manage frontend dependencies (`/demo/package.json` - although root `package.json` seems primary).
    * Run the Webpack build process (`webpack --config demo/webpack.config.js`) to generate static assets in `/demo/dist`.
    * Ensure the UI renders correctly and interacts as expected with the backend/library.
    * Write frontend-specific tests.
* **Primary Tools/Context:**
    * Commands: `yarn`/`npm`, `webpack`
    * Files: Files within `/demo/src`, `/demo/webpack.config.js`, `/demo/dist` (output)
    * Concepts: React, JSX, CSS, Webpack
* **Interactions:** Collaborates with `library-agent` on using `react-planner` features, and `backend-agent` if API integrations are needed beyond the core library. Reports build status to `ops-agent`.

### 3. Backend Agent (`backend-agent`)

* **Goal:** Develop and maintain the Cloudflare Worker gateway and the agent-specific API logic.
* **Key Responsibilities:**
    * Implement and manage routing logic in the main worker (`cloudflare-planner/worker/src/index.js`).
    * Develop features within the Agent Durable Object (`cloudflare-planner/worker/src/durable-object.js`) accessible via `/api/agent/`.
    * Define and manage the state stored within the Durable Object.
    * Implement helper functions for agent logic (`cloudflare-planner/worker/src/agent-helper.js`).
    * Write and maintain unit tests for worker and DO logic (`*.test.js`).
    * Define necessary environment variables/secrets (`wrangler.toml`, `.dev.vars`).
* **Primary Tools/Context:**
    * Commands: `wrangler`, `vitest` (for tests)
    * Files: Files within `cloudflare-planner/worker/src`, `cloudflare-planner/worker/wrangler.toml`
    * Concepts: Cloudflare Workers, Durable Objects, JavaScript/ES Modules, Fetch API
* **Interactions:** Provides API endpoints for the `floorplan-agent`. Collaborates with `ops-agent` on deployment configurations.

### 4. Core Library Agent (`library-agent`)

* **Goal:** Develop, maintain, and build the core `react-planner` library.
* **Key Responsibilities:**
    * Implement new features or fix bugs within the library source code (`/src`).
    * Refactor library code for performance or maintainability.
    * Manage library dependencies (`/package.json`).
    * Run the build process (`yarn build`) to update `/lib` and `/es`.
    * Write unit/integration tests for library components and functions.
    * Update library documentation (`/docs`).
* **Primary Tools/Context:**
    * Commands: `yarn`/`npm`, `babel` (via build scripts)
    * Files: Files within `/src`, `/package.json`, build configuration (`.babelrc` etc.)
    * Concepts: React, Redux, Immutable.js, Three.js (for 3D view), component libraries.
* **Interactions:** Provides features for the `frontend-agent`. May collaborate with `testing-agent` and `docs-agent`.

### 5. Floorplan Design Agent (`floorplan-agent`)

* **Goal:** Interact with the deployed application's API (`/api/agent/...`) to programmatically create, modify, or analyze floor plans.
* **Key Responsibilities:**
    * Understand user requirements for floor plan generation (e.g., "create a 2-bedroom apartment plan").
    * Translate requirements into API calls to the `/api/agent/...` endpoint managed by the `backend-agent`.
    * Process responses from the API (e.g., retrieving generated plan data).
    * Potentially interact with the `react-planner` state directly if integrated differently.
* **Primary Tools/Context:**
    * Tools: HTTP client library (`fetch`, `axios`, `requests`), JSON parsing.
    * API Endpoint: The publicly deployed URL + `/api/agent/...`
    * Concepts: Floor plan elements (walls, doors, items), project state structure.
* **Interactions:** Relies heavily on the API provided by the `backend-agent`.

### 6. Testing Agent (`testing-agent`)

* **Goal:** Ensure code quality and functionality through automated testing.
* **Key Responsibilities:**
    * Write unit tests for library functions (`/src`), backend logic (`/cloudflare-planner/worker/src`), and potentially frontend components (`/demo/src`).
    * Write integration tests for interactions between components or services.
    * Set up and run End-to-End (E2E) tests for the `demo` application (if applicable).
    * Execute test suites (`yarn test`, `wrangler dev --test-scheduled` or specific test commands).
    * Report test failures and successes.
* **Primary Tools/Context:**
    * Tools: `vitest` (used in worker), potentially Jest, React Testing Library, Cypress/Playwright.
    * Files: `*.test.js` files, testing configuration files.
* **Interactions:** Collaborates with all development agents (`frontend-agent`, `backend-agent`, `library-agent`) to ensure test coverage.

### 7. Documentation Agent (`docs-agent`)

* **Goal:** Keep project documentation accurate and up-to-date.
* **Key Responsibilities:**
    * Update the main `README.md` with project status, setup instructions, etc.
    * Maintain documentation within the `/docs` directory.
    * Update the `cloudflare-planner/README.md`.
    * Document API endpoints provided by the `backend-agent`.
    * Generate documentation from code comments if applicable (e.g., using JSDoc).
* **Primary Tools/Context:**
    * Tools: Markdown editor.
    * Files: `README.md`, files in `/docs`.
* **Interactions:** Collaborates with all development agents to document new features or changes.

## Potential Workflows

* **New Feature (Library -> Frontend):**
    1.  `library-agent` implements a new feature in `/src`.
    2.  `library-agent` runs `yarn build`.
    3.  `testing-agent` runs library tests.
    4.  `frontend-agent` updates `/demo/src` to use the new feature.
    5.  `frontend-agent` runs `webpack` build for the demo.
    6.  `testing-agent` potentially runs E2E tests on the demo.
    7.  `ops-agent` deploys the updated container/worker.
* **API Enhancement (Backend -> Floorplan Agent):**
    1.  `backend-agent` adds a new capability to the Durable Object API (`/cloudflare-planner/worker/src/durable-object.js`).
    2.  `testing-agent` adds tests for the new API endpoint.
    3.  `ops-agent` deploys the updated worker (`wrangler deploy`).
    4.  `floorplan-agent` utilizes the new API endpoint for advanced floor plan generation.
* **Deployment:**
    1.  Developer (or lead agent) triggers deployment.
    2.  `frontend-agent` ensures `/demo/dist` is up-to-date.
    3.  `ops-agent` builds/pushes container (if changed).
    4.  `ops-agent` runs `wrangler deploy` for the worker.
    5.  `ops-agent` verifies deployment health.

## Agent Configuration

* **Cloudflare API Token:** `ops-agent` and `backend-agent` will likely need a Cloudflare API token with appropriate permissions, configured via environment variables or Wrangler secrets.
* **Container Registry:** `ops-agent` may need credentials for a container registry if deploying the container service externally.
* **LLM API Keys:** Agents using specific LLMs (OpenAI, Gemini, Anthropic) will require their respective API keys, managed via the `colby` CLI or environment variables.
* **Agent Endpoint:** The `floorplan-agent` needs the base URL of the deployed Cloudflare worker.

This structure provides a starting point for coordinating AI agent efforts on the `ai-floorplans` project. Roles and workflows can be adapted as the project evolves.
