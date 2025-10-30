/**
 * AI Agent Helper - Translates natural language to planner commands
 *
 * This version uses the StructuredResponseTool and Zod for robust
 * JSON schema enforcement.
 */

import { z } from 'zod';
// Import the new tool from your toolbox
import { StructuredResponseTool } from './ai-toolbox/llm/structuredResponseTool.js';

// --- Zod Schema Definition ---
// This defines the strict structure we *want* the AI to give us.

// Define the structure of a valid planner command
const plannerCommandSchema = z.object({
  command: z.string().describe(
    "The specific command to execute (e.g., ADD_ITEM, ADD_WALL, MODE_2D, MODE_3D, LOAD_PROJECT)."
  ),
  params: z.record(z.any()).optional().default({}).describe(
    "An object of parameters for the command. E.g., { itemType: 'sofa', position: {x: 10, y: 20} }"
  ),
  reasoning: z.string().describe(
    "Brief explanation of why this command was chosen based on the user's request."
  )
});

// Define the structure for when the AI needs clarification
const clarifyCommandSchema = z.object({
  command: z.literal("CLARIFY").describe(
    "This exact string must be used when the user's request is unclear or missing information."
  ),
  question: z.string().describe(
    "A clear and specific question to ask the user to get the missing information."
  ),
  reasoning: z.string().describe(
    "Brief explanation of why clarification is needed."
  )
});

// Create a union schema that accepts EITHER a valid command OR a clarification request
const aiResponseSchema = z.union([
  plannerCommandSchema,
  clarifyCommandSchema
]);
// --- End of Zod Schema ---


/**
 * Parse natural language prompt using Worker AI and StructuredResponseTool
 */
export async function parsePromptWithAI(env, prompt, currentState = null) {
  
  // 1. Instantiate the new structured response tool
  const structuredTool = new StructuredResponseTool(env);

  // 2. Define the domain context (This is your "System Prompt")
  // This is where the core agent instructions are preserved.
  const domainContext = `You are an AI assistant that translates natural language requests into structured JSON commands for a 2D/3D floor planning application (react-planner).

The available commands are:
- ADD_ITEM: Add furniture or objects. Requires 'itemType' param (e.g., sofa, chair, table, desk, bed, bookcase, wardrobe). Can optionally take 'position: {x, y}'.
- ADD_WALL: Draw walls.
- MODE_2D: Switch to 2D view.
- MODE_3D: Switch to 3D view.
- LOAD_PROJECT: Load a saved plan.

Analyze the user's request below and generate the appropriate JSON command.
If the request is unclear, you MUST use the "CLARIFY" command and ask a specific question.`;

  // 3. Combine domain context, current state, and the user's prompt into a single payload
  const userRequest = `User request: "${prompt}"

${currentState ? `Current plan state summary: ${JSON.stringify(currentState, null, 2)}` : ''}

Please translate this request into a single, valid JSON command adhering to the schema.`;

  const fullTextPayload = `${domainContext}\n\n---\n\n${userRequest}`;

  // 4. Call the tool
  try {
    // This tells the AI to generate a response that *must* match the aiResponseSchema
    const response = await structuredTool.analyzeText(aiResponseSchema, fullTextPayload);

    if (response.success && response.structuredResult) {
      // Success! Return the validated, structured JSON object
      return response.structuredResult;
    }

    // AI failed to produce a valid, structured response
    console.error('AI structured response error:', response.error);
    console.warn('Falling back to rule-based parsing...');
    return fallbackParsing(prompt);

  } catch (error) {
    console.error('Error during AI structured parsing:', error);
    // Fallback to rule-based parsing
    return fallbackParsing(prompt);
  }
}

/**
 * Fallback rule-based parsing for common requests
 * (Kept as a safety net in case the AI fails)
 */
function fallbackParsing(prompt) {
  const lowerPrompt = prompt.toLowerCase();

  // Add furniture items
  const furnitureTypes = {
    'sofa': 'sofa',
    'couch': 'sofa',
    'chair': 'chair',
    'seat': 'chair',
    'table': 'table',
    'desk': 'desk',
    'bed': 'bed',
    'bookcase': 'bookcase',
    'bookshelf': 'bookcase',
    'wardrobe': 'wardrobe',
    'closet': 'wardrobe',
    'kitchen': 'kitchen',
    'fridge': 'fridge',
    'refrigerator': 'fridge',
    'sink': 'sink',
    'tv': 'tv',
    'television': 'tv'
  };

  for (const [keyword, itemType] of Object.entries(furnitureTypes)) {
    if (lowerPrompt.includes(keyword)) {
      // Try to extract position
      let position = null;
      const coordMatch = lowerPrompt.match(/(\d+)\s*,\s*(\d+)/);
      if (coordMatch) {
        position = { x: parseInt(coordMatch[1]), y: parseInt(coordMatch[2]) };
      }

      return {
        command: 'ADD_ITEM',
        params: {
          itemType,
          position
        },
        reasoning: `[Fallback] Detected request to add ${itemType}`
      };
    }
  }

  // Add wall
  if (lowerPrompt.includes('wall') || lowerPrompt.includes('draw')) {
    return {
      command: 'ADD_WALL',
      params: {},
      reasoning: '[Fallback] Detected request to add wall'
    };
  }

  // Switch views
  if (lowerPrompt.includes('3d') || lowerPrompt.includes('three dimensional')) {
    return {
      command: 'MODE_3D',
      params: {},
      reasoning: '[Fallback] Switching to 3D view'
    };
  }

  if (lowerPrompt.includes('2d')) {
    return {
      command: 'MODE_2D',
      params: {},
      reasoning: '[Fallback] Switching to 2D view'
    };
  }

  // Load project
  if (lowerPrompt.includes('load') || lowerPrompt.includes('open')) {
    return {
      command: 'CLARIFY',
      question: 'Which plan would you like to load? Please provide the plan ID.',
      reasoning: '[Fallback] Need plan ID to load'
    };
  }

  // Unknown request
  return {
    command: 'CLARIFY',
    question: 'I\'m not sure what you want to do. Could you please rephrase? You can ask me to add furniture, draw walls, or switch views.',
    reasoning: '[Fallback] Unable to parse the request'
  };
}

/**
 * Execute a sequence of commands (for complex multi-step requests)
 * (This is still used by the queue consumer in index.js)
 */
export async function executeCommandSequence(sessionStub, commands) {
  const results = [];

  for (const { command, params } of commands) {
    try {
      // This fetch will trigger the /command endpoint in the Durable Object,
      // which (thanks to our previous changes) will send the 
      // STEP_START and STEP_COMPLETE WebSocket messages.
      const response = await sessionStub.fetch('http://session/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, params })
      });

      const result = await response.json();
      results.push({
        command,
        params,
        success: result.success,
        result
      });

      // Stop on first failure
      if (!result.success) {
        break;
      }
    } catch (error) {
      results.push({
        command,
        params,
        success: false,
        error: error.message
      });
      break;
    }
  }

  return results;
}
