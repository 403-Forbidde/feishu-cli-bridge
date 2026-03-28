#!/usr/bin/env node
/**
 * Feishu CLI Bridge - Node.js/TypeScript Edition
 * Entry point
 */

import { loadConfig, validateConfig } from './core/config.js';

console.log('[Feishu CLI Bridge] Starting...');
console.log('[Feishu CLI Bridge] Node.js version:', process.version);

async function main(): Promise<void> {
  console.log('[Feishu CLI Bridge] Initializing...');

  // Day 2: Load configuration
  const config = loadConfig();
  console.log('[Feishu CLI Bridge] Configuration loaded');

  // Validate configuration
  const validation = validateConfig(config);
  if (!validation.valid) {
    console.error('[Feishu CLI Bridge] Configuration errors:');
    for (const error of validation.errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  console.log('[Feishu CLI Bridge] Day 2: Config module loaded successfully');
  console.log(`  - Feishu App ID: ${config.feishu.appId ? '***' : 'not set'}`);
  console.log(`  - OpenCode enabled: ${config.cli.opencode?.enabled || false}`);
  console.log(`  - Max sessions: ${config.session.maxSessions}`);
  console.log(`  - Log level: ${config.debug.logLevel}`);

  // TODO: Day 3 - Initialize Feishu client
  // const feishuClient = new FeishuClient(config);

  // TODO: Day 8 - Initialize managers
  // const projectManager = new ProjectManager(config);
  // const sessionManager = new SessionManager(config);

  console.log('[Feishu CLI Bridge] Press Ctrl+C to exit');

  // Keep process running
  await new Promise(() => {
    // Infinite wait - will be replaced with actual event loop
  });
}

main().catch((error: unknown) => {
  console.error('[Feishu CLI Bridge] Fatal error:', error);
  process.exit(1);
});
