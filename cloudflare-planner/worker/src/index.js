/**
 * Agent Gateway Worker - Main entry point
 * Handles incoming requests and routes them to appropriate Durable Objects
 */

import { PlannerSessionDO } from './durable-object.js';
import { parsePromptWithAI, executeCommandSequence } from './agent-helper.js';

// Export Durable Object class
export { PlannerSessionDO };

/**
 * CORS headers for browser requests
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/**
 * Utility helpers
 */
function isBlank(value) {
  return !value || (typeof value === 'string' && value.trim() === '');
}

function renderSetupPage({ missingTeslaKey, missingJwtKey, origin }) {
  const checklistItems = [
    {
      id: 'prep',
      title: 'Prepare a secure workspace',
      description: 'Open a private browser window, close any screen recorders, and make sure you have your Tesla account credentials ready.'
    },
    {
      id: 'oauth',
      title: 'Generate OAuth verifier + challenge',
      description: 'Run the provided script to create your PKCE verifier/challenge pair before visiting the Tesla SSO login page.'
    },
    {
      id: 'login',
      title: 'Log in at auth.tesla.com',
      description: 'Use the generated PKCE values, submit the login form, and copy the authorization code from the redirected URL.'
    },
    {
      id: 'exchange',
      title: 'Exchange the code for tokens',
      description: 'POST the authorization code to the token endpoint and record the resulting access + refresh tokens securely.'
    },
    {
      id: 'jwt',
      title: 'Create a JWT signing secret',
      description: 'Generate a 32+ byte random secret locally and store it in the worker environment as JWT_SIGNING_KEY.'
    }
  ];

  const copyButtons = [
    {
      id: 'copy-pkce',
      label: 'Copy PKCE generator (Node.js)',
      content: `import crypto from 'crypto';\n\nfunction randomString(length) {\n  return crypto.randomBytes(length).toString('base64url').slice(0, length);\n}\n\nconst verifier = randomString(86);\nconst challenge = crypto\n  .createHash('sha256')\n  .update(verifier)\n  .digest('base64url');\n\nconsole.log('CODE_VERIFIER=', verifier);\nconsole.log('CODE_CHALLENGE=', challenge);`
    },
    {
      id: 'copy-auth-url',
      label: 'Copy Tesla authorize URL',
      content: 'https://auth.tesla.com/oauth2/v3/authorize?client_id=ownerapi&code_challenge=<CODE_CHALLENGE>&code_challenge_method=S256&redirect_uri=https%3A%2F%2Fauth.tesla.com%2Fvoid%2Fcallback&response_type=code&scope=openid%20email%20offline_access&state=<STATE>'
    },
    {
      id: 'copy-token-request',
      label: 'Copy token exchange payload',
      content: `POST https://auth.tesla.com/oauth2/v3/token\nContent-Type: application/json\n\n{\n  "grant_type": "authorization_code",\n  "client_id": "ownerapi",\n  "code": "<AUTH_CODE>",\n  "code_verifier": "<CODE_VERIFIER>",\n  "redirect_uri": "https://auth.tesla.com/void/callback"\n}`
    },
    {
      id: 'copy-jwt-secret',
      label: 'Copy OpenSSL secret generator',
      content: 'openssl rand -base64 48'
    }
  ];

  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Tesla API + JWT Setup Guide</title>
      <style>
        :root {
          color-scheme: light dark;
          --bg: #0f172a;
          --card: #1e293b;
          --text: #e2e8f0;
          --accent: #38bdf8;
          --warning: #f59e0b;
          --success: #34d399;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
        body {
          margin: 0;
          background: linear-gradient(135deg, rgba(15,23,42,0.95), rgba(30,41,59,0.95));
          color: var(--text);
          min-height: 100vh;
          display: flex;
          flex-direction: column;
        }
        header {
          padding: 2rem clamp(1rem, 5vw, 4rem);
          background: rgba(15,23,42,0.8);
          backdrop-filter: blur(16px);
          border-bottom: 1px solid rgba(148,163,184,0.2);
        }
        h1 {
          margin: 0;
          font-size: clamp(2rem, 3vw, 3rem);
        }
        main {
          flex: 1;
          padding: 2rem clamp(1rem, 5vw, 4rem);
          display: grid;
          gap: 1.5rem;
        }
        section.card {
          background: rgba(30,41,59,0.9);
          border-radius: 18px;
          padding: clamp(1.5rem, 3vw, 2.5rem);
          box-shadow: 0 20px 45px rgba(15,23,42,0.35);
          border: 1px solid rgba(148,163,184,0.2);
        }
        .status-grid {
          display: grid;
          gap: 1rem;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        }
        .status {
          padding: 1rem 1.25rem;
          border-radius: 14px;
          display: flex;
          align-items: center;
          gap: 0.75rem;
          background: rgba(15,23,42,0.65);
          border: 1px solid rgba(148,163,184,0.18);
        }
        .status svg {
          flex-shrink: 0;
        }
        button.copy {
          background: rgba(56,189,248,0.12);
          color: var(--accent);
          border: 1px solid rgba(56,189,248,0.35);
          border-radius: 12px;
          padding: 0.6rem 1rem;
          cursor: pointer;
          font-size: 0.95rem;
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
        }
        button.copy:hover {
          background: rgba(56,189,248,0.2);
        }
        pre {
          background: rgba(15,23,42,0.85);
          border: 1px solid rgba(148,163,184,0.2);
          border-radius: 12px;
          padding: 1rem;
          overflow-x: auto;
          font-size: 0.9rem;
        }
        details {
          background: rgba(15,23,42,0.65);
          padding: 1rem 1.2rem;
          border-radius: 14px;
          border: 1px solid rgba(148,163,184,0.18);
        }
        details + details {
          margin-top: 1rem;
        }
        details summary {
          cursor: pointer;
          font-weight: 600;
        }
        .checklist {
          display: grid;
          gap: 0.9rem;
        }
        .checklist-item {
          display: flex;
          gap: 0.75rem;
          align-items: flex-start;
          padding: 0.8rem 1rem;
          border-radius: 12px;
          border: 1px solid rgba(148,163,184,0.16);
          background: rgba(15,23,42,0.55);
        }
        .checklist-item input[type="checkbox"] {
          width: 1.1rem;
          height: 1.1rem;
          margin-top: 0.3rem;
        }
        a.cta {
          display: inline-flex;
          align-items: center;
          gap: 0.6rem;
          padding: 0.75rem 1.2rem;
          border-radius: 999px;
          background: rgba(56,189,248,0.16);
          color: var(--accent);
          text-decoration: none;
          font-weight: 600;
          border: 1px solid rgba(56,189,248,0.35);
          margin-top: 0.75rem;
        }
        footer {
          padding: 1.5rem clamp(1rem, 5vw, 4rem);
          border-top: 1px solid rgba(148,163,184,0.2);
          background: rgba(15,23,42,0.8);
          font-size: 0.85rem;
          text-align: center;
        }
        mark {
          background: rgba(245,158,11,0.25);
          color: var(--text);
          padding: 0.1rem 0.35rem;
          border-radius: 6px;
        }
      </style>
    </head>
    <body>
      <header>
        <h1>Tesla API Authentication & JWT Setup</h1>
        <p>
          ${missingTeslaKey || missingJwtKey ? 'Your worker is almost ready — follow the steps below to configure the final secrets.' : 'All required secrets are configured. Use this page anytime you need to rotate credentials.'}
        </p>
      </header>
      <main>
        <section class="card">
          <h2>Configuration status</h2>
          <div class="status-grid">
            <div class="status" data-complete="${!missingTeslaKey}">
              ${missingTeslaKey ? icon('warning') : icon('success')}
              <div>
                <strong>Tesla API auth key</strong>
                <div>${missingTeslaKey ? 'Missing — complete the Tesla OAuth flow to capture the refresh token or long-lived key.' : 'Present in environment variable <code>TESLA_API_KEY</code>.'}</div>
              </div>
            </div>
            <div class="status" data-complete="${!missingJwtKey}">
              ${missingJwtKey ? icon('warning') : icon('success')}
              <div>
                <strong>JWT signing key</strong>
                <div>${missingJwtKey ? 'Missing — generate a strong shared secret and store it as <code>JWT_SIGNING_KEY</code>.' : 'Present in environment variable <code>JWT_SIGNING_KEY</code>.'}</div>
              </div>
            </div>
          </div>
        </section>

        <section class="card">
          <h2>Quick checklist</h2>
          <div class="checklist">
            ${checklistItems.map((item) => `
              <label class="checklist-item" for="${item.id}">
                <input type="checkbox" id="${item.id}" />
                <div>
                  <strong>${item.title}</strong>
                  <p>${item.description}</p>
                </div>
              </label>
            `).join('')}
          </div>
        </section>

        <section class="card">
          <h2>Tesla OAuth Flow</h2>
          <details open>
            <summary>Step 1 — Generate PKCE values</summary>
            <p>Use the script below to generate a random <code>code_verifier</code> and matching <code>code_challenge</code>. Avoid browser-like user agents and limit retries to keep the WAF happy.</p>
            ${copyBlock('copy-pkce')}
          </details>
          <details>
            <summary>Step 2 — Visit the Tesla authorize page</summary>
            <p>Open the authorize URL in a new tab, replacing <code>&lt;CODE_CHALLENGE&gt;</code> and <code>&lt;STATE&gt;</code> with your generated values. Use a non-browser user agent if you are scripting the request.</p>
            ${copyBlock('copy-auth-url')}
            <a class="cta" href="https://auth.tesla.com/oauth2/v3/authorize" target="_blank" rel="noopener">Launch Tesla Login</a>
            <p><mark>Tip:</mark> If you encounter a challenge page, wait a few minutes before retrying. The WAF rate limits repeated attempts.</p>
          </details>
          <details>
            <summary>Step 3 — Submit credentials</summary>
            <p>POST the hidden form fields, your Tesla email (<code>identity</code>), and password (<code>credential</code>) back to <code>/oauth2/v3/authorize</code>. Copy the <code>code</code> query value from the redirect response.</p>
          </details>
          <details>
            <summary>Step 4 — Exchange authorization code</summary>
            <p>Send the JSON payload below to <code>/oauth2/v3/token</code> and capture the <code>access_token</code> and <code>refresh_token</code>. Store the refresh token as your <code>TESLA_API_KEY</code> value.</p>
            ${copyBlock('copy-token-request')}
          </details>
          <details>
            <summary>Step 5 — Handle MFA (if enabled)</summary>
            <p>Fetch <code>/authorize/mfa/factors</code> with your <code>transaction_id</code>, then verify the active factor with the current TOTP code and CSRF token from the HTML form before retrying the token exchange.</p>
          </details>
        </section>

        <section class="card">
          <h2>JWT signing key</h2>
          <p>Use a long, random secret to sign any JWTs issued by this worker. The example below produces a 48-byte base64 string.</p>
          ${copyBlock('copy-jwt-secret')}
          <p>Once generated, store it securely:</p>
          <ol>
            <li>Open <strong>Wrangler</strong> or the Cloudflare dashboard for <code>${origin}</code>.</li>
            <li>Add a new text variable named <code>JWT_SIGNING_KEY</code> with the generated value.</li>
            <li>Redeploy the worker and verify the status lights above turn green.</li>
          </ol>
        </section>
      </main>
      <footer>
        Having trouble? Re-run the PKCE generator, double-check hidden form fields, and avoid TLS 1.3 when calling Tesla endpoints.
      </footer>

      <script>
        const snippets = ${JSON.stringify(copyButtons)};
        for (const { id, content } of snippets) {
          const button = document.querySelector('[data-snippet="' + id + '"]');
          if (!button) continue;
          button.addEventListener('click', async () => {
            try {
              await navigator.clipboard.writeText(content);
              button.dataset.copied = 'true';
              button.textContent = 'Copied!';
              setTimeout(() => {
                button.dataset.copied = 'false';
                button.textContent = button.dataset.label;
              }, 2000);
            } catch (err) {
              button.textContent = 'Copy failed';
              button.disabled = true;
            }
          });
        }
      </script>
    </body>
  </html>`;

  function icon(type) {
    if (type === 'success') {
      return `
        <svg width="28" height="28" fill="none" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="11" stroke="rgba(52,211,153,0.6)" stroke-width="2" />
          <path d="M7 12.5l3 3 7-7" stroke="var(--success)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>`;
    }
    return `
      <svg width="28" height="28" fill="none" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="11" stroke="rgba(245,158,11,0.6)" stroke-width="2" />
        <path d="M12 7v6" stroke="var(--warning)" stroke-width="2.2" stroke-linecap="round" />
        <circle cx="12" cy="16.5" r="1.2" fill="var(--warning)" />
      </svg>`;
  }

  function copyBlock(id) {
    const button = copyButtons.find((btn) => btn.id === id);
    if (!button) return '';
    return `
      <div style="display:flex; flex-direction:column; gap:0.75rem;">
        <button class="copy" data-snippet="${button.id}" data-label="${button.label}">
          <span>${button.label}</span>
        </button>
        <pre>${escapeHtml(button.content)}</pre>
      </div>
    `;
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

/**
 * Handle CORS preflight
 */
function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS
  });
}

/**
 * Verify authentication using constant-time comparison to prevent timing attacks
 */
async function verifyAuth(request, env) {
  const apiKey = env.WORKER_API_KEY;

  // If no WORKER_API_KEY is set, allow requests (development mode only)
  if (!apiKey) {
    console.warn('Warning: No WORKER_API_KEY set. Authentication bypassed for development.');
    return true;
  }

  // Validate Bearer token
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.substring(7); // Remove 'Bearer ' prefix

  // To prevent timing attacks, we hash both the provided token and the stored API key,
  // and then compare the hashes in a constant-time manner.
  try {
    const encoder = new TextEncoder();
    const tokenData = encoder.encode(token);
    const keyData = encoder.encode(apiKey);

    const [tokenHashBuffer, keyHashBuffer] = await Promise.all([
      crypto.subtle.digest('SHA-256', tokenData),
      crypto.subtle.digest('SHA-256', keyData)
    ]);

    const tokenHash = new Uint8Array(tokenHashBuffer);
    const keyHash = new Uint8Array(keyHashBuffer);

    if (tokenHash.length !== keyHash.length) {
      // This should not happen with a consistent hash algorithm but is a good safeguard.
      return false;
    }

    let mismatch = 0;
    for (let i = 0; i < tokenHash.length; i++) {
      mismatch |= tokenHash[i] ^ keyHash[i];
    }
    return mismatch === 0;
  } catch (e) {
    console.error('Error during auth verification:', e);
    return false;
  }
}

/**
 * Get or create a session Durable Object
 */
function getSession(env, sessionId) {
  // Generate a Durable Object ID from the session ID
  const id = env.PLANNER_SESSION.idFromName(sessionId);
  return env.PLANNER_SESSION.get(id);
}

/**
 * Main worker fetch handler
 */
export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleOptions();
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const missingTeslaKey = isBlank(env.TESLA_API_KEY);
    const missingJwtKey = isBlank(env.JWT_SIGNING_KEY);
    const configuration = {
      teslaApiKey: missingTeslaKey ? 'missing' : 'configured',
      jwtSigningKey: missingJwtKey ? 'missing' : 'configured'
    };

    try {
      // Health check (public endpoint)
      if (path === '/health') {
        return Response.json({
          status: 'healthy',
          service: 'react-planner-agent-gateway',
          timestamp: Date.now(),
          configuration
        }, { headers: CORS_HEADERS });
      }

      // Dedicated setup page (always accessible)
      if (request.method === 'GET' && path === '/setup') {
        return new Response(renderSetupPage({
          missingTeslaKey,
          missingJwtKey,
          origin: url.origin
        }), {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=UTF-8' }
        });
      }

      // Root path doubles as health unless configuration is missing
      if (path === '/' && request.method === 'GET') {
        if (missingTeslaKey || missingJwtKey) {
          return new Response(renderSetupPage({
            missingTeslaKey,
            missingJwtKey,
            origin: url.origin
          }), {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=UTF-8' }
          });
        }

        return Response.json({
          status: 'healthy',
          service: 'react-planner-agent-gateway',
          timestamp: Date.now(),
          configuration
        }, { headers: CORS_HEADERS });
      }

      // Halt all other endpoints until configuration is complete
      if (missingTeslaKey || missingJwtKey) {
        return Response.json(
          {
            error: 'Worker configuration incomplete',
            missing: {
              teslaApiKey: missingTeslaKey,
              jwtSigningKey: missingJwtKey
            },
            setupUrl: `${url.origin}/setup`
          },
          {
            status: 503,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
          }
        );
      }

      // Verify authentication for all protected endpoints
      if (!(await verifyAuth(request, env))) {
        return Response.json(
          { error: 'Unauthorized. Use: Authorization: Bearer <api-key>' },
          { status: 401, headers: CORS_HEADERS }
        );
      }

      // Session-based endpoints
      if (path.startsWith('/session/')) {
        return await handleSessionRequest(request, env, ctx, path);
      }

      // AI-powered modification endpoint
      if (path === '/modify') {
        return await handleModifyRequest(request, env, ctx);
      }

      // Direct command endpoint (bypasses AI)
      if (path === '/command') {
        return await handleCommandRequest(request, env, ctx);
      }

      // Screenshot endpoint
      if (path === '/screenshot') {
        return await handleScreenshotRequest(request, env, ctx);
      }

      // Plan management
      if (path === '/save') {
        return await handleSaveRequest(request, env, ctx);
      }

      if (path === '/load') {
        return await handleLoadRequest(request, env, ctx);
      }

      // List sessions (admin endpoint)
      if (path === '/sessions') {
        return await handleListSessions(request, env, ctx);
      }

      return Response.json(
        { error: 'Not found', path },
        { status: 404, headers: CORS_HEADERS }
      );

    } catch (error) {
      console.error('Worker error:', error);
      return Response.json(
        { error: error.message, stack: error.stack },
        { status: 500, headers: CORS_HEADERS }
      );
    }
  },

  /**
   * Queue consumer for asynchronous tasks
   */
  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        const { sessionId, task, params } = message.body;

        console.log('Processing queue message:', task, 'for session:', sessionId);

        const session = getSession(env, sessionId);

        switch (task) {
          case 'AUTO_SAVE':
            await session.fetch('http://session/save', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ planId: params.planId })
            });
            break;

          case 'EXECUTE_COMMAND':
            await session.fetch('http://session/command', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                command: params.command,
                params: params.commandParams
              })
            });
            break;

          case 'BATCH_COMMANDS':
            const commands = params.commands;
            await executeCommandSequence(session, commands);
            break;

          default:
            console.warn('Unknown task type:', task);
        }

        message.ack();
      } catch (error) {
        console.error('Queue processing error:', error);
        message.retry();
      }
    }
  }
};

/**
 * Handle session-specific requests
 */
async function handleSessionRequest(request, env, ctx, path) {
  const sessionId = path.split('/')[2];
  const action = path.split('/')[3] || 'state';

  if (!sessionId) {
    return Response.json(
      { error: 'Session ID required' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const session = getSession(env, sessionId);

  // Forward request to Durable Object
  const sessionPath = `/${action}`;
  const sessionUrl = new URL(request.url);
  sessionUrl.pathname = sessionPath;

  return await session.fetch(sessionUrl.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.body
  });
}

/**
 * Handle AI-powered modification requests
 */
async function handleModifyRequest(request, env, ctx) {
  if (request.method !== 'POST') {
    return Response.json(
      { error: 'Method not allowed' },
      { status: 405, headers: CORS_HEADERS }
    );
  }

  const { prompt, sessionId, includeState = true } = await request.json();

  if (!prompt || !sessionId) {
    return Response.json(
      { error: 'prompt and sessionId are required' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const session = getSession(env, sessionId);

  // Optionally get current state for context
  let currentState = null;
  if (includeState) {
    try {
      const stateResponse = await session.fetch('http://session/state');
      const stateData = await stateResponse.json();
      currentState = stateData.state;
    } catch (error) {
      console.warn('Failed to get current state:', error);
    }
  }

  // Parse prompt with AI
  const parsed = await parsePromptWithAI(env, prompt, currentState);

  // Handle clarification requests
  if (parsed.command === 'CLARIFY') {
    return Response.json({
      success: false,
      needsClarification: true,
      question: parsed.question,
      reasoning: parsed.reasoning
    }, { headers: CORS_HEADERS });
  }

  // Execute the command
  const response = await session.fetch('http://session/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command: parsed.command,
      params: parsed.params
    })
  });

  const result = await response.json();

  return Response.json({
    ...result,
    interpretation: {
      command: parsed.command,
      params: parsed.params,
      reasoning: parsed.reasoning
    }
  }, { headers: CORS_HEADERS });
}

/**
 * Handle direct command requests (no AI)
 */
async function handleCommandRequest(request, env, ctx) {
  if (request.method !== 'POST') {
    return Response.json(
      { error: 'Method not allowed' },
      { status: 405, headers: CORS_HEADERS }
    );
  }

  const { command, params, sessionId } = await request.json();

  if (!command || !sessionId) {
    return Response.json(
      { error: 'command and sessionId are required' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const session = getSession(env, sessionId);

  const response = await session.fetch('http://session/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, params })
  });

  return new Response(response.body, {
    status: response.status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

/**
 * Handle screenshot requests
 */
async function handleScreenshotRequest(request, env, ctx) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('sessionId');

  if (!sessionId) {
    return Response.json(
      { error: 'sessionId parameter required' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const session = getSession(env, sessionId);

  const response = await session.fetch('http://session/screenshot');

  return new Response(response.body, {
    status: response.status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

/**
 * Handle save requests
 */
async function handleSaveRequest(request, env, ctx) {
  if (request.method !== 'POST') {
    return Response.json(
      { error: 'Method not allowed' },
      { status: 405, headers: CORS_HEADERS }
    );
  }

  const { sessionId, planId } = await request.json();

  if (!sessionId || !planId) {
    return Response.json(
      { error: 'sessionId and planId are required' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const session = getSession(env, sessionId);

  const response = await session.fetch('http://session/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId })
  });

  return new Response(response.body, {
    status: response.status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

/**
 * Handle load requests
 */
async function handleLoadRequest(request, env, ctx) {
  if (request.method !== 'POST') {
    return Response.json(
      { error: 'Method not allowed' },
      { status: 405, headers: CORS_HEADERS }
    );
  }

  const { sessionId, planId } = await request.json();

  if (!sessionId || !planId) {
    return Response.json(
      { error: 'sessionId and planId are required' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const session = getSession(env, sessionId);

  const response = await session.fetch('http://session/load', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId })
  });

  return new Response(response.body, {
    status: response.status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

/**
 * List active sessions (admin endpoint)
 */
async function handleListSessions(request, env, ctx) {
  // This is a placeholder - actual implementation would require
  // additional tracking or using the DO's list API
  return Response.json({
    message: 'Session listing not yet implemented',
    info: 'Use sessionId to access specific sessions'
  }, { headers: CORS_HEADERS });
}