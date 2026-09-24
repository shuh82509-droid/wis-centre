import test from 'node:test';
import assert from 'node:assert/strict';

async function moduleUrl(pathname, nonce) {
  globalThis.window = { location: { pathname } };
  try {
    const { modules } = await import(`./src/data.ts?candidate-path-${nonce}`);
    return modules.find((module) => module.id === 'live-room-management')?.url;
  } finally {
    delete globalThis.window;
  }
}

test('normal Hub embeds the unchanged formal live module', async () => {
  assert.equal(
    await moduleUrl('/yxb/wis-marketing-hub/', 'formal'),
    '/yxb/wis-marketing-hub/modules/live-room-management/',
  );
});

test('r55 candidate Hub embeds only the r55 candidate live module', async () => {
  assert.equal(
    await moduleUrl('/yxb/wis-marketing-hub/live-flow-candidate-r55/', 'candidate'),
    '/yxb/wis-marketing-hub/live-flow-candidate-r55/modules/live-room-management/',
  );
});

test('lookalike path cannot switch the formal Hub to candidate modules', async () => {
  assert.equal(
    await moduleUrl('/yxb/wis-marketing-hub/live-flow-candidate-r55-other/', 'lookalike'),
    '/yxb/wis-marketing-hub/modules/live-room-management/',
  );
});
