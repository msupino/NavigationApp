// Recovery orchestration for charts-monitor.yml. Kept outside the workflow so the important
// rule -- refresh first, alert only if refresh fails -- is executable in tests.

export function uniqueProducerWorkflows(stale) {
  return [...new Set((stale || []).map(item => item && item.workflow).filter(Boolean))];
}

export async function recoverStaleFeeds({
  initial,
  dispatch,
  check,
  sleep,
  maxWaitMs = 23 * 60 * 1000,
  pollMs = 60 * 1000,
}) {
  const workflows = uniqueProducerWorkflows(initial && initial.stale);
  const dispatched = [];
  const dispatchErrors = [];

  await Promise.all(workflows.map(async workflow => {
    try {
      await dispatch(workflow);
      dispatched.push(workflow);
    } catch (error) {
      dispatchErrors.push({ workflow, error: error && error.message ? error.message : String(error) });
    }
  }));

  let snapshot = initial;
  let waitedMs = 0;
  // No producer accepted a dispatch, so waiting cannot improve the result.
  while (dispatched.length && waitedMs < maxWaitMs) {
    const waitMs = Math.min(pollMs, maxWaitMs - waitedMs);
    await sleep(waitMs);
    waitedMs += waitMs;
    snapshot = await check();
    // A transiently unverifiable feed is not proof of recovery. Keep polling rather than
    // closing an existing incident on a raw.githubusercontent network blip.
    if (!snapshot.stale.length && !snapshot.unknown.length) break;
  }

  return {
    snapshot,
    workflows,
    dispatched,
    dispatchErrors,
    waitedMs,
    recovered: !snapshot.stale.length && !snapshot.unknown.length,
  };
}
