import { createAuthTool } from "../auth-tools";
import { createBrowserRender } from "../browser-tools";
import { createAIExtractorTool } from "../extractor-tools";
import {
    createAIToolsHealthChecker,
    createAuthToolsHealthChecker,
    createBrowserToolsHealthChecker,
    createExtractorToolsHealthChecker,
    createToolsHealthMonitor,
    ToolsHealthMonitor,
} from "../health";
import type { ExtendedEnv, Env } from "../env";

import { EmbeddingTool } from "./embeddingTool";
import { StructuredResponseTool } from "./structuredResponseTool";

export function createEmbeddingTool(env: Env): EmbeddingTool {
    return new EmbeddingTool(env);
}

export function createStructuredResponseTool(env: Env): StructuredResponseTool {
    return new StructuredResponseTool(env);
}

export interface ToolConfig {
    ai: {
        maxRetries: number;
        timeout: number;
        fallbackModels: boolean;
    };
    browser: {
        timeout: number;
        viewport: {
            width: number;
            height: number;
        };
        userAgent?: string;
    };
    auth: {
        tokenExpiry: number;
        allowedOrigins: string[];
    };
    health: {
        checkInterval: number;
        enableMetrics: boolean;
    };
}

export const DEFAULT_TOOL_CONFIG: ToolConfig = {
    ai: {
        maxRetries: 3,
        timeout: 60000,
        fallbackModels: true,
    },
    browser: {
        timeout: 30000,
        viewport: { width: 1920, height: 1080 },
        userAgent: "Cloudflare-Worker-Toolkit/1.0",
    },
    auth: {
        tokenExpiry: 3600,
        allowedOrigins: ["*"],
    },
    health: {
        checkInterval: 60000,
        enableMetrics: true,
    },
};

export function createToolkit(env: ExtendedEnv) {
    return {
        ai: {
            embedding: createEmbeddingTool(env),
            structured: createStructuredResponseTool(env),
            extractor: createAIExtractorTool(env),
        },
        browser: createBrowserRender(env),
        auth: createAuthTool(env),
        health: createToolsHealthMonitor(env),
    };
}

export function createToolkitWithHealth(env: ExtendedEnv, config: Partial<ToolConfig> = {}) {
    const finalConfig: ToolConfig = {
        ai: { ...DEFAULT_TOOL_CONFIG.ai, ...config.ai },
        browser: { ...DEFAULT_TOOL_CONFIG.browser, ...config.browser },
        auth: { ...DEFAULT_TOOL_CONFIG.auth, ...config.auth },
        health: { ...DEFAULT_TOOL_CONFIG.health, ...config.health },
    };

    const toolkit = createToolkit(env);

    return {
        ...toolkit,
        config: finalConfig,
        healthCheck: () => toolkit.health.quickHealthCheck(),
        systemHealth: () => toolkit.health.checkSystemHealth(),
        isReady: () => toolkit.health.isReady(),
        isAlive: () => toolkit.health.isAlive(),
        getMetrics: () => toolkit.health.getMetrics(),
    };
}

export {
    createAIToolsHealthChecker,
    createAuthToolsHealthChecker,
    createBrowserToolsHealthChecker,
    createExtractorToolsHealthChecker,
    createToolsHealthMonitor,
    ToolsHealthMonitor,
};
