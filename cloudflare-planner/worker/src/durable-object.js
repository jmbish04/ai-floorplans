/**
 * PlannerSessionDO - Durable Object for managing React Planner container instances
 * Implements the Actor pattern for session management
 */

export class PlannerSessionDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.containerInstance = null;
    this.sessionMetadata = null;
    this.lastActivity = Date.now();
    this.webSocket = null; // <-- NEW: To hold the live WebSocket
  }

  /**
   * Initialize the session and load metadata
   */
  async initialize() {
    if (this.sessionMetadata) return;

    // Load session metadata from durable storage
    this.sessionMetadata = await this.state.storage.get('metadata') || {
      createdAt: Date.now(),
      planId: null,
      userId: null,
      modifications: []
    };

    console.log('Session initialized:', this.state.id.toString());
  }

  /**
   * Get or create container instance for this session
   */
  async getContainer() {
    if (!this.containerInstance) {
      console.log('Getting container instance for session:', this.state.id.toString());

      // Get container instance from Container Bindings
      // The container ID is derived from the Durable Object ID for consistency
      const containerId = this.state.id.toString();
      this.containerInstance = this.env.PLANNER_CONTAINER.get(containerId);

      // Configure container sleep behavior
      // Containers will sleep after 60 seconds of inactivity
      this.containerInstance.sleepAfter(60000);
    }

    return this.containerInstance;
  }

  /**
   * Helper to send a message to the connected WebSocket, if it exists.
   */
  sendWebSocketMessage(type, payload) {
    if (this.webSocket) {
      try {
        this.webSocket.send(JSON.stringify({ type, ...payload }));
      } catch (e) {
        console.error('Failed to send WebSocket message:', e);
      }
    }
  }

  /**
   * Execute a command on the container
   */
  async executeCommand(command, params) {
    await this.initialize();
    this.lastActivity = Date.now();

    this.sendWebSocketMessage('STEP_START', { 
      action: 'executeCommand', 
      command, 
      params,
      message: `Executing command: ${command}`
    });

    const container = await this.getContainer();

    // Forward command to container's API
    const response = await container.fetch('http://container/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, params })
    });

    const result = await response.json();

    // Log modification
    if (result.success) {
      this.sessionMetadata.modifications.push({
        timestamp: Date.now(),
        command,
        params
      });

      // Persist metadata
      await this.state.storage.put('metadata', this.sessionMetadata);
    }
    
    this.sendWebSocketMessage('STEP_COMPLETE', { 
      action: 'executeCommand', 
      command, 
      result,
      message: `Command ${command} finished. Success: ${result.success}`
    });

    return result;
  }

  /**
   * Dispatch a Redux action to the planner
   */
  async dispatchAction(action) {
    await this.initialize();
    this.lastActivity = Date.now();

    this.sendWebSocketMessage('STEP_START', { 
      action: 'dispatchAction', 
      actionType: action?.type,
      message: `Dispatching action: ${action?.type || 'UNKNOWN'}`
    });

    const container = await this.getContainer();

    const response = await container.fetch('http://container/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    });

    const result = await response.json();
    
    this.sendWebSocketMessage('STEP_COMPLETE', { 
      action: 'dispatchAction', 
      actionType: action?.type,
      result,
      message: `Action ${action?.type || 'UNKNOWN'} finished.`
    });

    return result;
  }

  /**
   * Get current planner state
   */
  async getState() {
    await this.initialize();
    this.lastActivity = Date.now();
    
    this.sendWebSocketMessage('STEP_START', { 
      action: 'getState', 
      message: 'Fetching current state...'
    });

    const container = await this.getContainer();

    const response = await container.fetch('http://container/state', {
      method: 'GET'
    });

    const result = await response.json();

    this.sendWebSocketMessage('STEP_COMPLETE', { 
      action: 'getState',
      message: 'State fetched.'
      // Don't send the full state over WS unless needed, it could be large
      // result: { success: result.success } 
    });
    
    return result;
  }

  /**
   * Execute custom script in the browser
   */
  async executeScript(script) {
    await this.initialize();
    this.lastActivity = Date.now();
    
    this.sendWebSocketMessage('STEP_START', { 
      action: 'executeScript', 
      message: 'Executing custom script...'
    });

    const container = await this.getContainer();

    const response = await container.fetch('http://container/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script })
    });

    const result = await response.json();
    
    this.sendWebSocketMessage('STEP_COMPLETE', { 
      action: 'executeScript',
      result,
      message: `Script execution finished. Success: ${result.success}`
    });

    return result;
  }

  /**
   * Take a screenshot of the planner
   */
  async takeScreenshot() {
    await this.initialize();
    this.lastActivity = Date.now();

    this.sendWebSocketMessage('STEP_START', { 
      action: 'takeScreenshot', 
      message: 'Taking screenshot...'
    });

    const container = await this.getContainer();

    const response = await container.fetch('http://container/screenshot', {
      method: 'GET'
    });
    
    const result = await response.json();

    this.sendWebSocketMessage('STEP_COMPLETE', { 
      action: 'takeScreenshot',
      message: `Screenshot finished. Success: ${result.success}`
    });

    return result;
  }

  /**
   * Save plan to R2 storage
   */
  async savePlan(planId) {
    await this.initialize();
    
    this.sendWebSocketMessage('STEP_START', { 
      action: 'savePlan',
      planId,
      message: `Saving plan ${planId}...`
    });

    const stateResult = await this.getState();

    if (!stateResult.success) {
      this.sendWebSocketMessage('STEP_ERROR', { 
        action: 'savePlan',
        planId,
        message: 'Failed to get state for saving.'
      });
      throw new Error('Failed to get state for saving');
    }

    // Save to R2
    const planKey = `plans/${planId}.json`;
    await this.env.PLANNER_STORAGE.put(
      planKey,
      JSON.stringify(stateResult.state, null, 2),
      {
        httpMetadata: {
          contentType: 'application/json'
        },
        customMetadata: {
          sessionId: this.state.id.toString(),
          savedAt: new Date().toISOString()
        }
      }
    );

    // Update metadata
    this.sessionMetadata.planId = planId;
    this.sessionMetadata.lastSaved = Date.now();
    await this.state.storage.put('metadata', this.sessionMetadata);
    
    const result = { success: true, planId, key: planKey };

    this.sendWebSocketMessage('STEP_COMPLETE', { 
      action: 'savePlan',
      result,
      message: `Plan ${planId} saved successfully.`
    });

    return result;
  }

  /**
   * Load plan from R2 storage
   */
  async loadPlan(planId) {
    await this.initialize();

    this.sendWebSocketMessage('STEP_START', { 
      action: 'loadPlan',
      planId,
      message: `Loading plan ${planId}...`
    });

    const planKey = `plans/${planId}.json`;
    const plan = await this.env.PLANNER_STORAGE.get(planKey);

    if (!plan) {
      this.sendWebSocketMessage('STEP_ERROR', { 
        action: 'loadPlan',
        planId,
        message: `Plan not found: ${planId}`
      });
      throw new Error(`Plan not found: ${planId}`);
    }

    const planData = await plan.json();

    // Load into planner via container
    const result = await this.executeCommand('LOAD_PROJECT', {
      sceneJSON: planData
    });

    // Update metadata
    this.sessionMetadata.planId = planId;
    await this.state.storage.put('metadata', this.sessionMetadata);
    
    this.sendWebSocketMessage('STEP_COMPLETE', { 
      action: 'loadPlan',
      result,
      message: `Plan ${planId} loaded. Success: ${result.success}`
    });

    return result;
  }

  /**
   * Get session metadata
   */
  async getMetadata() {
    await this.initialize();
    return {
      sessionId: this.state.id.toString(),
      lastActivity: this.lastActivity,
      ...this.sessionMetadata
    };
  }

  /**
   * HTTP handler for requests to the Durable Object
   */
  async fetch(request) {
    await this.initialize();

    // *** NEW: Handle WebSocket upgrade requests ***
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader === 'websocket') {
      console.log('WebSocket upgrade request received for session:', this.state.id.toString());
      
      const [client, server] = Object.values(new WebSocketPair());

      // Store the "server" side of the socket
      this.webSocket = server;

      // Set up listeners
      this.webSocket.accept();
      
      this.webSocket.addEventListener('message', async (event) => {
        // This is where you would handle incoming messages from the client
        // For now, we just log it. The primary flow is HTTP request -> WS status updates
        console.log('WebSocket message received:', event.data);
        this.sendWebSocketMessage('ECHO', { 
          message: 'Message received', 
          data: event.data 
        });
      });

      this.webSocket.addEventListener('close', () => {
        console.log('WebSocket closed for session:', this.state.id.toString());
        this.webSocket = null; // Clear the socket on close
      });

      this.webSocket.addEventListener('error', (error) => {
        console.error('WebSocket error:', error);
        this.webSocket = null; // Clear the socket on error
      });
      
      this.sendWebSocketMessage('CONNECTED', { 
        message: 'WebSocket connection established with Durable Object.'
      });

      // Return the "client" side of the socket to the browser
      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    }
    // *** End of WebSocket logic ***


    // Existing HTTP logic
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      switch (path) {
        case '/command':
          const { command, params } = await request.json();
          const result = await this.executeCommand(command, params);
          return Response.json(result);

        case '/action':
          const { action } = await request.json();
          const actionResult = await this.dispatchAction(action);
          return Response.json(actionResult);

        case '/state':
          const state = await this.getState();
          return Response.json(state);

        case '/screenshot':
          const screenshot = await this.takeScreenshot();
          return Response.json(screenshot);

        case '/execute':
          const { script } = await request.json();
          const scriptResult = await this.executeScript(script);
          return Response.json(scriptResult);

        case '/save':
          const { planId: savePlanId } = await request.json();
          const saveResult = await this.savePlan(savePlanId);
          return Response.json(saveResult);

        case '/load':
          const { planId: loadPlanId } = await request.json();
          const loadResult = await this.loadPlan(loadPlanId);
          return Response.json(loadResult);

        case '/metadata':
          const metadata = await this.getMetadata();
          return Response.json(metadata);

        default:
          return Response.json({ error: 'Not found in Durable Object' }, { status: 404 });
      }
    } catch (error) {
      console.error('Durable Object error:', error);
      this.sendWebSocketMessage('EXECUTION_ERROR', { 
        error: error.message,
        stack: error.stack,
        message: 'An error occurred during execution.'
      });
      return Response.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }
  }

  /**
   * Alarm handler for scheduled tasks (e.g., auto-save)
   */
  async alarm() {
    console.log('Alarm triggered for session:', this.state.id.toString());

    // Auto-save if there's a planId and modifications
    if (this.sessionMetadata && this.sessionMetadata.planId && this.sessionMetadata.modifications.length > 0) {
      try {
        console.log(`Auto-saving plan ${this.sessionMetadata.planId}`);
        await this.savePlan(this.sessionMetadata.planId);
        this.sessionMetadata.modifications = []; // Clear modifications after save
        await this.state.storage.put('metadata', this.sessionMetadata);
        console.log('Auto-save successful');
      } catch (error) {
        console.error('Auto-save failed:', error);
      } finally {
        // Schedule next alarm (every 5 minutes)
        await this.state.storage.setAlarm(Date.now() + 300000);
      }
    }
  }
}
