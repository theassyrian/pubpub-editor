export const transactionAggregator = (
	editorView,
	key,
	waitIntervalMs = 15,
	forceInteralMs = 30,
) => {
	let queue = [];
	let oldestDataMs = Date.now();
	let timeout;

	const issuePendingTransaction = () => {
		const trans = editorView.state.tr;
		trans.setMeta(key, queue);
		queue = [];
		editorView.dispatch(trans);
	};

	const enqueue = (data) => {
		const now = Date.now();
		if (queue.length === 0) {
			oldestDataMs = now;
		}
		queue.push(data);
		const timeUntilMustIssueMs = forceInteralMs - (now - oldestDataMs);
		const timeToDelayMs = Math.max(0, Math.min(waitIntervalMs, timeUntilMustIssueMs));
		if (timeout) {
			clearTimeout(timeout);
		}
		timeout = setTimeout(issuePendingTransaction, timeToDelayMs);
	};

	return { enqueue: enqueue };
};
