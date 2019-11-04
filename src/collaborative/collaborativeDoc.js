import { receiveTransaction, sendableSteps } from 'prosemirror-collab';

import {
	receiveInitialChanges,
	getHighestKeyFromChanges,
	sendSteps,
	receiveCollabChanges,
} from './firebase';

const Actions = {
	CONNECT: 'connect',
	START_SEND: 'start_send',
	FINISH_SEND: 'finish_send',
	RECEIVE_CHANGE: 'receive_change',
	START_FLUSH: 'start_flush',
	FINISH_FLUSH: 'finish_flush',
};

export const Status = {
	LOADING: 'loading',
	IDLE: 'idle',
	FLUSHING: 'flushing',
	SENDING: 'sending',
};

const reducer = (state, action) => {
	const { pendingChanges, status } = state;
	console.log('dispatched', action.type);
	switch (action.type) {
		case Actions.CONNECT:
			return { status: Status.IDLE, highestKey: action.highestKey };
		case Actions.RECEIVE_CHANGE:
			return { pendingChanges: [...pendingChanges, action.change] };
		case Actions.START_SEND:
			return status === Status.IDLE ? { status: Status.SENDING } : {};
		case Actions.FINISH_SEND:
			return { status: Status.IDLE };
		case Actions.START_FLUSH:
			return status === Status.IDLE ? { status: Status.FLUSHING } : {};
		case Actions.FINISH_FLUSH:
			return { status: Status.IDLE, pendingChanges: [], highestKey: action.highestKey };
		default:
			return state.status;
	}
};

export default ({ editorView, firebaseRef, initialKey, prosemirrorSchema, onStateChange }) => {
	let state = {
		pendingChanges: [],
		highestKey: initialKey,
		status: Status.LOADING,
	};

	const handleStateChange = (prevState, nextState, dispatch) => {
		const { status, pendingChanges, highestKey } = nextState;
		onStateChange(nextState);
		if (prevState.status !== status) {
			console.log(prevState.status, '->', status);
		}
		// When we connect, listen for subsequent changes.
		if (status === Status.IDLE && prevState.status === Status.LOADING) {
			receiveCollabChanges(firebaseRef, highestKey, prosemirrorSchema, (change) => {
				dispatch({ type: Actions.RECEIVE_CHANGE, change: change });
			});
		}
		// Send some changes, if they are available.
		if (status === Status.SENDING && prevState.status !== Status.SENDING) {
			const sendable = sendableSteps(editorView.state);
			if (sendable) {
				const { steps, clientID } = sendable;
				sendSteps(firebaseRef, steps, clientID, nextState.highestKey).then(() => {
					dispatch({ type: Actions.FINISH_SEND });
				});
			} else {
				dispatch({ type: Actions.FINISH_SEND });
			}
		}

		// Flushing is a synchronous operation, but it's not atomic from the point of the reducer.
		// Calling editorView.dispatch() will generate START_SEND actions which the reducer
		// will ignore when status !== IDLE. So we have to take care about when we enter and exit
		// this state.
		if (status === Status.FLUSHING && prevState.status !== Status.FLUSHING) {
			pendingChanges.forEach(({ steps, clientIds }) => {
				const tx = receiveTransaction(editorView.state, steps, clientIds);
				editorView.dispatch(tx);
			});
			dispatch({
				type: Actions.FINISH_FLUSH,
				highestKey: Math.max(highestKey, getHighestKeyFromChanges(pendingChanges)),
			});
		} else if (status === Status.IDLE && pendingChanges.length > 0) {
			dispatch({ type: Actions.START_FLUSH });
		}
	};

	const dispatch = (action) => {
		const prevState = state;
		state = { ...state, ...reducer(state, action) };
		handleStateChange(prevState, state, dispatch);
	};

	const connect = () => {
		receiveInitialChanges(firebaseRef, initialKey, prosemirrorSchema).then((initialChange) => {
			const { steps, clientIds, highestKey } = initialChange;
			const tx = receiveTransaction(editorView.state, steps, clientIds);
			editorView.dispatch(tx);
			dispatch({ type: Actions.CONNECT, highestKey: highestKey });
		});
	};

	const sendCollabChanges = () => {
		dispatch({ type: Actions.START_SEND });
	};

	connect();

	return {
		sendCollabChanges: sendCollabChanges,
	};
};
