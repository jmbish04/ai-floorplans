import {
  createToolsFromOpenAPISpec,
  runWithTools,
  Ai, // Assuming Ai type is available or importable
} from "@cloudflare/ai-utils";
import type { Tool, Message } from "@cloudflare/ai-utils"; // Import relevant types
import type { Env } from "../env";

// Define common configuration options for createToolsFromOpenAPISpec if needed
// For example, adding default headers like User-Agent
const defaultToolOptions = {
  overrides: [
    {
      // Example: Add User-Agent for all github.com requests
      matcher: ({ url }: { url: URL }) => url.hostname.endsWith("github.com"),
      values: {
        headers: {
          "User-Agent":
            "Cloudflare-Worker-AI-Function-Calling/1.0",
        },
      },
    },
    // Add other common overrides if needed
  ],
};

// Interface for the options passed to callFunction
interface FunctionCallOptions {
  messages: Message[];
  toolsOrSpec: Tool[] | string; // Can be a pre-defined tools array or an OpenAPI spec URL/content
  toolOptions?: any; // Optional: Override default tool options if needed per call
}

export class FunctionCallingAI {
  private ai: Ai;

  /**
   * Initializes the FunctionCallingAI service.
   * @param ai The AI binding from Cloudflare Worker environment.
   */
  constructor(ai: Ai) {
    if (!ai) {
      throw new Error("Cloudflare AI binding (env.AI) is required.");
    }
    this.ai = ai;
  }

  /**
   * Calls a specified AI model with messages and tools for function calling.
   * @param modelName The identifier of the AI model to use (must support function calling).
   * @param options Options including messages and tools/OpenAPI spec.
   * @returns The response from the AI model, potentially including function calls.
   */
  async callFunction(
    modelName: string,
    { messages, toolsOrSpec, toolOptions = {} }: FunctionCallOptions
  ): Promise<any> { // Replace 'any' with a more specific response type if known
    let tools: Tool[];

    try {
      // Check if toolsOrSpec is a string (URL or OpenAPI content)
      if (typeof toolsOrSpec === "string") {
        console.log(`Creating tools from OpenAPI spec: ${toolsOrSpec.substring(0, 100)}...`);
        // Merge default options with per-call options
        const finalToolOptions = {
          ...defaultToolOptions,
          ...toolOptions,
          overrides: [
            ...(defaultToolOptions.overrides || []),
            ...(toolOptions.overrides || []),
          ],
        };
        tools = await createToolsFromOpenAPISpec(toolsOrSpec, finalToolOptions);
        console.log(`Successfully created ${tools.length} tools from spec.`);
      } else {
        // Assume toolsOrSpec is already a Tool[] array
        tools = toolsOrSpec;
         console.log(`Using provided ${tools.length} tools.`);
      }

      // Ensure messages and tools are provided
      if (!messages || messages.length === 0) {
        throw new Error("Messages are required for function calling.");
      }
      if (!tools || tools.length === 0) {
        throw new Error("Tools are required for function calling.");
      }

      console.log(`Running function call with model: ${modelName}`);
      const response = await runWithTools(
        this.ai,
        modelName,
        {
          messages: messages,
          tools: tools,
          // You can add other model parameters here if needed, e.g., temperature, max_tokens
        }
      );

       console.log("Function call completed successfully.");
      return response;

    } catch (error) {
      console.error("Error during function call:", error);
      // Re-throw the error or handle it as needed
      throw error;
    }
  }
}

// --- Example Usage within a Cloudflare Worker ---

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const functionAI = new FunctionCallingAI(env.AI);

    // Example 1: Using Hermes with GitHub OpenAPI spec
    const githubSpecUrl = "https://gist.githubusercontent.com/mchenco/fd8f20c8f06d50af40b94b0671273dc1/raw/f9d4b5cd5944cc32d6b34cad0406d96fd3acaca6/partial_api.github.com.json";
    const userMessages: Message[] = [
        { role: "user", content: "Who is Cloudflare on github?" }
    ];

    try {
      const hermesModel = "@hf/nousresearch/hermes-2-pro-mistral-7b";
      const responseHermes = await functionAI.callFunction(hermesModel, {
        messages: userMessages,
        toolsOrSpec: githubSpecUrl,
        // Optional: Add specific toolOptions for this call if needed
        // toolOptions: { overrides: [ ... specific overrides ... ] }
      });

      console.log("Response from Hermes:", JSON.stringify(responseHermes, null, 2));


      // Example 2: Using Llama 4 Scout with manually defined tools (example tool)
      const llamaModel = "@cf/meta/llama-4-scout-17b-16e-instruct";
      const manualTools: Tool[] = [
        {
            type: "function",
            function: {
                name: "getCurrentWeather",
                description: "Get the current weather for a specified location",
                parameters: {
                    type: "object",
                    properties: {
                        location: {
                            type: "string",
                            description: "The city and state, e.g., San Francisco, CA"
                        },
                        unit: {
                            type: "string",
                            enum: ["Celsius", "Fahrenheit"],
                            description: "The unit for temperature"
                        }
                    },
                    required: ["location"]
                }
            }
        }
      ];
       const weatherMessages: Message[] = [
           { role: "user", content: "What's the weather like in London?" }
       ];

      const responseLlama = await functionAI.callFunction(llamaModel, {
        messages: weatherMessages,
        toolsOrSpec: manualTools
      });

      console.log("\nResponse from Llama 4 Scout:", JSON.stringify(responseLlama, null, 2));


      // You would typically process the response (e.g., execute tool calls)
      // For simplicity, we just return the last response here.
      return new Response(JSON.stringify({ hermesResponse: responseHermes, llamaResponse: responseLlama }), {
        headers: { "Content-Type": "application/json" },
      });

    } catch (error: any) {
      console.error("Worker fetch handler error:", error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
  },
};
