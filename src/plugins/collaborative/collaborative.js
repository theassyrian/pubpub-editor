import { Plugin, PluginKey } from 'prosemirror-state';
import { collab, receiveTransaction, sendableSteps } from 'prosemirror-collab';

import { generateHash, storeCheckpoint } from '../../utils';

import { createFirebaseAuthority } from './authority';
import { createDiscussionsPlugin } from './discussions';

export const collaborativePluginKey = new PluginKey('collaborative');

const transactionContainsInvalidKeys = (transaction) => {
	const validMetaKeys = ['history$', 'paste', 'uiEvent'];
	return Object.keys(transaction.meta).some((key) => {
		const keyIsValid = validMetaKeys.includes(key);
		return !keyIsValid;
	});
};

export const sendCollabChanges = async (editorView, transaction) => {
	const { authority } = collaborativePluginKey.getState(editorView.state);
	const editable = editorView.props.editable(editorView.state);
	const sendable = sendableSteps(editorView.state);
	if (sendable && editable && !transactionContainsInvalidKeys(transaction)) {
		await authority.sendCollabChanges(editorView, transaction);
	}
};

const createFirebaseCollabPlugin = ({ authority, checkpointInterval, onError }) => {
	const ongoingTransaction = false;
	const pendingChanges = [];

	const processPendingChanges = (editorView) => {
		if (!ongoingTransaction) {
			pendingChanges.forEach(({ steps, clientIds, highestKey }) => {
				const trans = receiveTransaction(editorView.state, steps, clientIds);
				editorView.dispatch(trans);
				if (checkpointInterval && highestKey > 0 && highestKey % checkpointInterval === 0) {
					storeCheckpoint(authority.getFirebaseRef(), editorView.state.doc, highestKey);
				}
			});
		}
	};

	const receiveSteps = (editorView) => (change) => {
		try {
			if (change) {
				pendingChanges.push(change);
			}
			processPendingChanges(editorView);
		} catch (err) {
			onError(err);
		}
	};

	const setupView = (editorView) => {
		authority
			.connect(receiveSteps(editorView))
			.then(() => {
				const connectedTransaction = editorView.state.tr;
				connectedTransaction.setMeta('connectedToFirebase', true);
				editorView.dispatch(connectedTransaction);
			})
			.catch(onError);
		return {};
	};

	return new Plugin({
		key: collaborativePluginKey,
		state: {
			init: () => {
				return {
					authority: authority,
					isConnected: false,
				};
			},
			apply: (transaction, pluginState) => {
				return {
					authority: authority,
					isConnected: pluginState.isConnected || transaction.meta.connectedToFirebase,
				};
			},
		},
		view: setupView,
	});
};

export default (schema, { onError, collaborativeOptions = {} }) => {
	const { firebaseRef, initialDocKey, clientData } = collaborativeOptions;
	if (!firebaseRef) {
		return [];
	}

	const localClientId = `${clientData.id}-${generateHash(6)}`;
	const branchId = firebaseRef.key.replace('branch-', '');

	const authority = createFirebaseAuthority({
		branchId: branchId,
		firebaseRef: firebaseRef,
		initialKey: initialDocKey,
		prosemirrorSchema: schema,
	});

	return [
		collab({ clientID: localClientId }),
		createFirebaseCollabPlugin({
			authority: authority,
			checkpointInterval: 100,
			onError: (err) => {
				console.error(err);
				onError(err);
			},
		}),
		createDiscussionsPlugin({ authority: authority }),
	];
};
