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

    try {
      // Health check (public endpoint)
      if (path === '/health') {
        return Response.json({
          status: 'healthy',
          service: 'react-planner-agent-gateway',
          timestamp: Date.now()
        }, { headers: CORS_HEADERS });
      }

      async function ensureAuthorized() {
        if (!(await verifyAuth(request, env))) {
          return Response.json(
            { error: 'Unauthorized. Use: Authorization: Bearer <api-key>' },
            { status: 401, headers: CORS_HEADERS }
          );
        }
        return null;
      }

      // Session-based endpoints
      if (path.startsWith('/session/')) {
        const authResponse = await ensureAuthorized();
        if (authResponse) {
          return authResponse;
        }
        return await handleSessionRequest(request, env, ctx, path);
      }

      // AI-powered modification endpoint
      if (path === '/modify') {
        const authResponse = await ensureAuthorized();
        if (authResponse) {
          return authResponse;
        }
        return await handleModifyRequest(request, env, ctx);
      }

      // Direct command endpoint (bypasses AI)
      if (path === '/command') {
        const authResponse = await ensureAuthorized();
        if (authResponse) {
          return authResponse;
        }
        return await handleCommandRequest(request, env, ctx);
      }

      // Screenshot endpoint
      if (path === '/screenshot') {
        const authResponse = await ensureAuthorized();
        if (authResponse) {
          return authResponse;
        }
        return await handleScreenshotRequest(request, env, ctx);
      }

      // Plan management
      if (path === '/save') {
        const authResponse = await ensureAuthorized();
        if (authResponse) {
          return authResponse;
        }
        return await handleSaveRequest(request, env, ctx);
      }

      if (path === '/load') {
        const authResponse = await ensureAuthorized();
        if (authResponse) {
          return authResponse;
        }
        return await handleLoadRequest(request, env, ctx);
      }

      // List sessions (admin endpoint)
      if (path === '/sessions') {
        const authResponse = await ensureAuthorized();
        if (authResponse) {
          return authResponse;
        }
        return await handleListSessions(request, env, ctx);
      }

      // Fallback: forward all other requests to the renderer service so the
      // React frontend (and its static assets) can be served without
      // requiring API authentication.
      if (env.RENDERER_SERVICE) {
        return await env.RENDERER_SERVICE.fetch(request);
      }

      console.error('Renderer service binding is missing. Cannot forward request:', path);
      return Response.json(
        { error: 'Renderer service unavailable', path },
        { status: 502, headers: CORS_HEADERS }
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