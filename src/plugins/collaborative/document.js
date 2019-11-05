import { receiveTransaction, sendableSteps } from 'prosemirror-collab';
import { Plugin, PluginKey } from 'prosemirror-state';

import {
	receiveInitialChanges,
	getHighestKeyFromChanges,
	sendSteps,
	receiveCollabChanges,
} from './firebase';

const collabPluginKey = new PluginKey('collab');

const Actions = {
	CONNECT: 'connect',
	DISABLE: 'disable',
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
	DISABLED: 'disabled',
};

export const getCollabState = (editorState) => collabPluginKey.getState(editorState);

export const sendCollabChanges = (editorState) =>
	getCollabState(editorState).dispatch({ type: Actions.START_SEND });

export const collabIsReady = (editorState) => {
	const { status } = getCollabState(editorState);
	return status !== Status.LOADING;
};

const reducer = (state, action) => {
	const { pendingChanges, status } = state;
	switch (action.type) {
		case Actions.CONNECT:
			return { status: Status.IDLE, highestKey: action.highestKey };
		case Actions.DISABLE:
			return { status: Status.DISABLED };
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
			return state;
	}
};

export const createDocumentPlugin = (schema, props) => {
	const {
		onError,
		collaborativeOptions: { firebaseRef, initialDocKey, onUpdateHighestKey, onStatusChange },
	} = props;

	let editorView;
	let state = {
		pendingChanges: [],
		highestKey: initialDocKey,
		status: Status.LOADING,
	};

	const handleStateChange = (prevState, nextState, dispatch) => {
		const { status, pendingChanges, highestKey } = nextState;
		if (onStatusChange && prevState.status !== status) {
			onStatusChange(status);
		}
		if (onUpdateHighestKey && prevState.highestKey !== highestKey) {
			onUpdateHighestKey(highestKey);
		}
		// When we connect, listen for subsequent changes.
		if (status === Status.IDLE && prevState.status === Status.LOADING) {
			receiveCollabChanges(firebaseRef, highestKey, schema, (change) => {
				dispatch({ type: Actions.RECEIVE_CHANGE, change: change });
			});
		}
		// Send some changes, if they are available.
		if (status === Status.SENDING && prevState.status !== Status.SENDING) {
			const sendable = sendableSteps(editorView.state);
			if (sendable) {
				const { steps, clientID } = sendable;
				sendSteps(firebaseRef, steps, clientID, nextState.highestKey)
					.then(() => {
						dispatch({ type: Actions.FINISH_SEND });
					})
					.catch(onError);
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
				try {
					const tx = receiveTransaction(editorView.state, steps, clientIds);
					editorView.dispatch(tx);
				} catch (err) {
					onError(err);
				}
			});
			dispatch({
				type: Actions.FINISH_FLUSH,
				highestKey: Math.max(highestKey, getHighestKeyFromChanges(pendingChanges)),
			});
		} else if (status === Status.IDLE && pendingChanges.length > 0) {
			dispatch({ type: Actions.START_FLUSH });
		} else if (status === Status.IDLE && sendableSteps(editorView.state)) {
			dispatch({ type: Actions.START_SEND });
		}
	};

	const dispatch = (action) => {
		const prevState = state;
		state = { ...state, ...reducer(state, action) };
		handleStateChange(prevState, state, dispatch);
	};

	const connect = (nextEditorView) => {
		editorView = nextEditorView;
		if (firebaseRef) {
			receiveInitialChanges(firebaseRef, initialDocKey, schema).then((initialChange) => {
				const { steps, clientIds, highestKey } = initialChange;
				try {
					dispatch({ type: Actions.CONNECT, highestKey: highestKey });
					const tx = receiveTransaction(editorView.state, steps, clientIds);
					editorView.dispatch(tx);
				} catch (err) {
					onError(err);
				}
			});
		} else {
			dispatch({ type: Actions.DISABLE });
		}
	};

	return new Plugin({
		key: collabPluginKey,
		state: {
			init: () => ({
				...state,
				dispatch: dispatch,
			}),
			apply: () => ({
				...state,
				dispatch: dispatch,
			}),
		},
		view: (nextEditorView) => {
			connect(nextEditorView);
			return {};
		},
	});
};
