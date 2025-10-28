/**
 * Unit tests for Worker routing and main endpoints
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock environment
const mockEnv = {
  PLANNER_SESSION: {
    idFromName: vi.fn((name) => ({ name, toString: () => name })),
    get: vi.fn((id) => ({
      fetch: vi.fn(async (url, options) => {
        return new Response(JSON.stringify({ success: true, mockData: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    }))
  },
  AI: {
    run: vi.fn(async () => ({
      response: JSON.stringify({
        command: 'ADD_ITEM',
        params: { itemType: 'sofa' },
        reasoning: 'Test reasoning'
      })
    }))
  },
  PLANNER_TASKS: {
    send: vi.fn()
  },
  PLANNER_STORAGE: {
    get: vi.fn(),
    put: vi.fn()
  },
  PLANNER_METADATA: {
    get: vi.fn(),
    put: vi.fn()
  },
  TESLA_API_KEY: 'mock-tesla-key',
  JWT_SIGNING_KEY: 'mock-jwt-key'
};

const mockCtx = {
  waitUntil: vi.fn()
};

describe('Worker Main Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render setup page when configuration is missing', async () => {
    const { default: worker } = await import('../src/index.js');

    const env = {
      ...mockEnv,
      TESLA_API_KEY: '',
      JWT_SIGNING_KEY: ''
    };

    const request = new Request('http://localhost/');
    const response = await worker.fetch(request, env, mockCtx);
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(body).toContain('Tesla API Authentication & JWT Setup');
  });

  it('should block API access until configuration is complete', async () => {
    const { default: worker } = await import('../src/index.js');

    const env = {
      ...mockEnv,
      TESLA_API_KEY: '',
      JWT_SIGNING_KEY: ''
    };

    const request = new Request('http://localhost/modify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 's', prompt: 'Hi' })
    });

    const response = await worker.fetch(request, env, mockCtx);
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.error).toContain('Worker configuration incomplete');
    expect(data.setupUrl).toContain('/setup');
  });

  it('should return health check response', async () => {
    const { default: worker } = await import('../src/index.js');

    const request = new Request('http://localhost/health');
    const response = await worker.fetch(request, mockEnv, mockCtx);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe('healthy');
    expect(data.service).toBe('react-planner-agent-gateway');
    expect(data.timestamp).toBeDefined();
  });

  it('should handle CORS preflight', async () => {
    const { default: worker } = await import('../src/index.js');

    const request = new Request('http://localhost/modify', { method: 'OPTIONS' });
    const response = await worker.fetch(request, mockEnv, mockCtx);

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('should return 404 for unknown routes', async () => {
    const { default: worker } = await import('../src/index.js');

    const request = new Request('http://localhost/unknown-route');
    const response = await worker.fetch(request, mockEnv, mockCtx);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe('Not found');
  });
});

describe('Session Endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should forward request to correct session', async () => {
    const { default: worker } = await import('../src/index.js');

    const sessionId = 'test-session-123';
    const request = new Request(`http://localhost/session/${sessionId}/state`);

    await worker.fetch(request, mockEnv, mockCtx);

    expect(mockEnv.PLANNER_SESSION.idFromName).toHaveBeenCalledWith(sessionId);
    expect(mockEnv.PLANNER_SESSION.get).toHaveBeenCalled();
  });

  it('should return 400 if session ID is missing', async () => {
    const { default: worker } = await import('../src/index.js');

    const request = new Request('http://localhost/session//state');
    const response = await worker.fetch(request, mockEnv, mockCtx);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('Session ID required');
  });
});

describe('Modify Endpoint (AI-Powered)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should process natural language prompt', async () => {
    const { default: worker } = await import('../src/index.js');

    const request = new Request('http://localhost/modify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'test-session',
        prompt: 'Add a sofa'
      })
    });

    const response = await worker.fetch(request, mockEnv, mockCtx);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockEnv.AI.run).toHaveBeenCalled();
  });

  it('should return 400 if prompt is missing', async () => {
    const { default: worker } = await import('../src/index.js');

    const request = new Request('http://localhost/modify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'test-session'
        // Missing prompt
      })
    });

    const response = await worker.fetch(request, mockEnv, mockCtx);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('required');
  });

  it('should return 400 if sessionId is missing', async () => {
    const { default: worker } = await import('../src/index.js');

    const request = new Request('http://localhost/modify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Add a sofa'
        // Missing sessionId
      })
    });

    const response = await worker.fetch(request, mockEnv, mockCtx);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('required');
  });

  it('should handle method not allowed', async () => {
    const { default: worker } = await import('../src/index.js');

    const request = new Request('http://localhost/modify', {
      method: 'GET'
    });

    const response = await worker.fetch(request, mockEnv, mockCtx);
    const data = await response.json();

    expect(response.status).toBe(405);
    expect(data.error).toContain('Method not allowed');
  });
});

describe('Command Endpoint (Direct)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should process direct commands', async () => {
    const { default: worker } = await import('../src/index.js');

    const request = new Request('http://localhost/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'test-session',
        command: 'MODE_3D',
        params: {}
      })
    });

    const response = await worker.fetch(request, mockEnv, mockCtx);

    expect(response.status).toBe(200);
    expect(mockEnv.PLANNER_SESSION.get).toHaveBeenCalled();
  });

  it('should return 400 if command is missing', async () => {
    const { default: worker } = await import('../src/index.js');

    const request = new Request('http://localhost/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'test-session'
        // Missing command
      })
    });

    const response = await worker.fetch(request, mockEnv, mockCtx);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('required');
  });
});

describe('Screenshot Endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should capture screenshot', async () => {
    const { default: worker } = await import('../src/index.js');

    const request = new Request('http://localhost/screenshot?sessionId=test-session');
    const response = await worker.fetch(request, mockEnv, mockCtx);

    expect(response.status).toBe(200);
    expect(mockEnv.PLANNER_SESSION.get).toHaveBeenCalled();
  });

  it('should return 400 if sessionId query param is missing', async () => {
    const { default: worker } = await import('../src/index.js');

    const request = new Request('http://localhost/screenshot');
    const response = await worker.fetch(request, mockEnv, mockCtx);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('sessionId');
  });
});

describe('Save/Load Endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should save plan', async () => {
    const { default: worker } = await import('../src/index.js');

    const request = new Request('http://localhost/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'test-session',
        planId: 'my-plan'
      })
    });

    const response = await worker.fetch(request, mockEnv, mockCtx);

    expect(response.status).toBe(200);
    expect(mockEnv.PLANNER_SESSION.get).toHaveBeenCalled();
  });

  it('should load plan', async () => {
    const { default: worker } = await import('../src/index.js');

    const request = new Request('http://localhost/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'test-session',
        planId: 'my-plan'
      })
    });

    const response = await worker.fetch(request, mockEnv, mockCtx);

    expect(response.status).toBe(200);
    expect(mockEnv.PLANNER_SESSION.get).toHaveBeenCalled();
  });

  it('should return 400 if planId is missing on save', async () => {
    const { default: worker } = await import('../src/index.js');

    const request = new Request('http://localhost/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'test-session'
        // Missing planId
      })
    });

    const response = await worker.fetch(request, mockEnv, mockCtx);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain('required');
  });
});

describe('Queue Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should process queue messages', async () => {
    const { default: worker } = await import('../src/index.js');

    const batch = {
      messages: [
        {
          body: {
            sessionId: 'test-session',
            task: 'EXECUTE_COMMAND',
            params: {
              command: 'MODE_3D',
              commandParams: {}
            }
          },
          ack: vi.fn(),
          retry: vi.fn()
        }
      ]
    };

    await worker.queue(batch, mockEnv);

    expect(mockEnv.PLANNER_SESSION.get).toHaveBeenCalled();
    expect(batch.messages[0].ack).toHaveBeenCalled();
  });

  it('should retry on error', async () => {
    const { default: worker } = await import('../src/index.js');

    // Mock error in session fetch
    const errorSession = {
      fetch: vi.fn().mockRejectedValue(new Error('Test error'))
    };
    mockEnv.PLANNER_SESSION.get.mockReturnValue(errorSession);

    const batch = {
      messages: [
        {
          body: {
            sessionId: 'test-session',
            task: 'EXECUTE_COMMAND',
            params: {}
          },
          ack: vi.fn(),
          retry: vi.fn()
        }
      ]
    };

    await worker.queue(batch, mockEnv);

    expect(batch.messages[0].retry).toHaveBeenCalled();
    expect(batch.messages[0].ack).not.toHaveBeenCalled();
  });
});
