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
   * Execute a command on the container
   */
  async executeCommand(command, params) {
    await this.initialize();
    this.lastActivity = Date.now();

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

    return result;
  }

  /**
   * Dispatch a Redux action to the planner
   */
  async dispatchAction(action) {
    await this.initialize();
    this.lastActivity = Date.now();

    const container = await this.getContainer();

    const response = await container.fetch('http://container/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    });

    return await response.json();
  }

  /**
   * Get current planner state
   */
  async getState() {
    await this.initialize();
    this.lastActivity = Date.now();

    const container = await this.getContainer();

    const response = await container.fetch('http://container/state', {
      method: 'GET'
    });

    return await response.json();
  }

  /**
   * Execute custom script in the browser
   */
  async executeScript(script) {
    await this.initialize();
    this.lastActivity = Date.now();

    const container = await this.getContainer();

    const response = await container.fetch('http://container/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script })
    });

    return await response.json();
  }

  /**
   * Take a screenshot of the planner
   */
  async takeScreenshot() {
    await this.initialize();
    this.lastActivity = Date.now();

    const container = await this.getContainer();

    const response = await container.fetch('http://container/screenshot', {
      method: 'GET'
    });

    return await response.json();
  }

  /**
   * Save plan to R2 storage
   */
  async savePlan(planId) {
    await this.initialize();

    const stateResult = await this.getState();

    if (!stateResult.success) {
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

    return { success: true, planId, key: planKey };
  }

  /**
   * Load plan from R2 storage
   */
  async loadPlan(planId) {
    await this.initialize();

    const planKey = `plans/${planId}.json`;
    const plan = await this.env.PLANNER_STORAGE.get(planKey);

    if (!plan) {
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
          return Response.json({ error: 'Not found' }, { status: 404 });
      }
    } catch (error) {
      console.error('Durable Object error:', error);
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
