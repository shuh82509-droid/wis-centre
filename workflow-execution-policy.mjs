// A pilot account restriction never authorizes processing the entire historical queue.
export function workflowExecutionPolicy(env = process.env) {
  const writesEnabled = env.WORKFLOW_WRITES_ENABLED !== 'false';
  const pilotConfigured = Object.hasOwn(env, 'FLOW_WRITES_ALLOWED_NUMBERS');
  const writeAccounts = pilotConfigured
    ? String(env.FLOW_WRITES_ALLOWED_NUMBERS).split(',').map(v => v.trim()).filter(Boolean)
    : null;
  return {
    writesEnabled,
    writeAccounts,
    backgroundEnabled: writesEnabled && !pilotConfigured && env.WORKFLOW_BACKGROUND_ENABLED !== 'false',
    legacyWritesEnabled: writesEnabled && !pilotConfigured,
  };
}
