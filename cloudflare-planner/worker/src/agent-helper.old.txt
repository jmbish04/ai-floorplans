/**
 * AI Agent Helper - Translates natural language to planner commands
 */

/**
 * Parse natural language prompt using Worker AI
 */
export async function parsePromptWithAI(env, prompt, currentState = null) {
  const systemPrompt = `You are an AI assistant that translates natural language requests into structured commands for a floor planning application (react-planner).

The available commands are:
- ADD_ITEM: Add furniture or objects (types: sofa, chair, table, desk, bed, bookcase, wardrobe, etc.)
- ADD_WALL: Draw walls in the plan
- MODE_2D: Switch to 2D view
- MODE_3D: Switch to 3D view
- LOAD_PROJECT: Load a saved plan

For ADD_ITEM commands, you need to extract:
- itemType: the type of furniture/object
- position: {x, y} coordinates if mentioned, or you can suggest typical positions

For ADD_WALL commands:
- Start and end points if mentioned

Respond with a JSON object containing:
{
  "command": "COMMAND_NAME",
  "params": { /* command-specific parameters */ },
  "reasoning": "Brief explanation of your interpretation"
}

If the request is unclear or requires more information, respond with:
{
  "command": "CLARIFY",
  "question": "What additional information do you need?",
  "reasoning": "Why clarification is needed"
}`;

  const userPrompt = `User request: "${prompt}"

${currentState ? `Current plan state summary: ${JSON.stringify(currentState, null, 2)}` : ''}

Please translate this request into a planner command.`;

  try {
    const response = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 500,
      temperature: 0.2
    });

    // Parse the AI response
    let parsed;
    try {
      // Extract JSON from response
      const jsonMatch = response.response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        // No JSON found - log for debugging and fall back
        console.warn('AI response did not contain valid JSON');
        console.warn('AI Response:', response.response.substring(0, 200));
        console.warn('Falling back to rule-based parsing...');
        parsed = fallbackParsing(prompt);
      }
    } catch (parseError) {
      // JSON parsing failed - log for debugging and fall back
      console.warn('Failed to parse JSON from AI response:', parseError.message);
      console.warn('Attempted to parse:', response.response.substring(0, 200));
      console.warn('Falling back to rule-based parsing...');
      parsed = fallbackParsing(prompt);
    }

    return parsed;
  } catch (error) {
    console.error('AI parsing error:', error);
    // Fallback to rule-based parsing
    return fallbackParsing(prompt);
  }
}

/**
 * Fallback rule-based parsing for common requests
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
        reasoning: `Detected request to add ${itemType}`
      };
    }
  }

  // Add wall
  if (lowerPrompt.includes('wall') || lowerPrompt.includes('draw')) {
    return {
      command: 'ADD_WALL',
      params: {},
      reasoning: 'Detected request to add wall'
    };
  }

  // Switch views
  if (lowerPrompt.includes('3d') || lowerPrompt.includes('three dimensional')) {
    return {
      command: 'MODE_3D',
      params: {},
      reasoning: 'Switching to 3D view'
    };
  }

  if (lowerPrompt.includes('2d')) {
    return {
      command: 'MODE_2D',
      params: {},
      reasoning: 'Switching to 2D view'
    };
  }

  // Load project
  if (lowerPrompt.includes('load') || lowerPrompt.includes('open')) {
    return {
      command: 'CLARIFY',
      question: 'Which plan would you like to load? Please provide the plan ID.',
      reasoning: 'Need plan ID to load'
    };
  }

  // Unknown request
  return {
    command: 'CLARIFY',
    question: 'I\'m not sure what you want to do. Could you please rephrase? You can ask me to add furniture, draw walls, or switch views.',
    reasoning: 'Unable to parse the request'
  };
}

/**
 * Execute a sequence of commands (for complex multi-step requests)
 */
export async function executeCommandSequence(sessionStub, commands) {
  const results = [];

  for (const { command, params } of commands) {
    try {
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
