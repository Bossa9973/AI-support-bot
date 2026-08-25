const assert = require('assert');

function runTest(name, envSetup, expectedProvider, expectedModel, expectedBaseUrl) {
  // Clear env and cached modules
  delete process.env.AI_PROVIDER;
  delete process.env.OPENROUTER_ENABLED;
  delete process.env.NVIDIA_ENABLED;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.NVIDIA_API_KEY;
  delete process.env.OPENROUTER_MODEL;
  delete process.env.NVIDIA_MODEL;
  delete process.env.OPENROUTER_BASE_URL;
  delete process.env.NVIDIA_BASE_URL;

  Object.assign(process.env, envSetup);

  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/ai/client')];

  const config = require('../src/config');
  const { getActiveProvider } = require('../src/ai/client');

  const provider = getActiveProvider();

  assert.strictEqual(provider.provider, expectedProvider, `[${name}] Expected provider ${expectedProvider}, got ${provider.provider}`);
  assert.strictEqual(provider.model, expectedModel, `[${name}] Expected model ${expectedModel}, got ${provider.model}`);
  assert.strictEqual(provider.baseURL, expectedBaseUrl, `[${name}] Expected baseURL ${expectedBaseUrl}, got ${provider.baseURL}`);

  console.log(`✅ [${name}] Passed -> Provider: ${provider.providerName}, Model: ${provider.model}`);
}

console.log('--- Testing AI Provider Switcher & Toggles ---\n');

// Test 1: OpenRouter default when OPENROUTER_ENABLED=1, NVIDIA_ENABLED=0
runTest(
  'OpenRouter Active (openrouter=1, nvidia=0)',
  {
    OPENROUTER_ENABLED: '1',
    NVIDIA_ENABLED: '0',
    OPENROUTER_API_KEY: 'sk-or-test',
    OPENROUTER_MODEL: 'stealth/ox-alpha'
  },
  'openrouter',
  'stealth/ox-alpha',
  'https://openrouter.ai/api/v1'
);

// Test 2: NVIDIA NIM active when OPENROUTER_ENABLED=0, NVIDIA_ENABLED=1
runTest(
  'NVIDIA NIM Active (openrouter=0, nvidia=1)',
  {
    OPENROUTER_ENABLED: '0',
    NVIDIA_ENABLED: '1',
    NVIDIA_API_KEY: 'nvapi-test',
    NVIDIA_MODEL: 'meta/llama-3.3-70b-instruct'
  },
  'nvidia',
  'meta/llama-3.3-70b-instruct',
  'https://integrate.api.nvidia.com/v1'
);

// Test 3: Explicit AI_PROVIDER=nvidia override
runTest(
  'Explicit AI_PROVIDER=nvidia Override',
  {
    AI_PROVIDER: 'nvidia',
    OPENROUTER_ENABLED: '1',
    NVIDIA_ENABLED: '1',
    NVIDIA_API_KEY: 'nvapi-test',
    NVIDIA_MODEL: 'deepseek-ai/deepseek-r1'
  },
  'nvidia',
  'deepseek-ai/deepseek-r1',
  'https://integrate.api.nvidia.com/v1'
);

// Test 4: Custom Base URL for self-hosted NVIDIA NIM container
runTest(
  'Custom Base URL (Self-Hosted NIM)',
  {
    AI_PROVIDER: 'nvidia',
    NVIDIA_API_KEY: 'none',
    NVIDIA_MODEL: 'meta/llama-3.3-70b-instruct',
    NVIDIA_BASE_URL: 'http://192.168.1.50:8000/v1'
  },
  'nvidia',
  'meta/llama-3.3-70b-instruct',
  'http://192.168.1.50:8000/v1'
);

console.log('\n🎉 All AI provider toggle tests passed successfully!');
