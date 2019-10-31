import { Plugin, PluginKey } from 'prosemirror-state';
import { collab, receiveTransaction, sendableSteps } from 'prosemirror-collab';

import { generateHash, storeCheckpoint } from '../../utils';

import { createFirebaseAuthority } from './authority';

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
		await authority.sendSteps(sendable.steps, sendable.clientID);
	}
};

const createFirebaseCollabPlugin = ({
	firebaseRef,
	prosemirrorSchema,
	initialKey,
	branchId,
	onError,
	checkpointInterval,
}) => {
	const authority = createFirebaseAuthority({
		firebaseRef: firebaseRef,
		initialKey: initialKey,
		prosemirrorSchema: prosemirrorSchema,
		branchId: branchId,
	});

	const receiveSteps = (editorView) => ({ steps, clientIds, highestKey }) => {
		try {
			const trans = receiveTransaction(editorView.state, steps, clientIds);
			editorView.dispatch(trans);
			if (checkpointInterval && highestKey > 0 && highestKey % checkpointInterval === 0) {
				storeCheckpoint(firebaseRef, editorView.state.doc, highestKey);
			}
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
	return [
		collab({ clientID: localClientId }),
		createFirebaseCollabPlugin({
			firebaseRef: firebaseRef,
			prosemirrorSchema: schema,
			initialKey: initialDocKey,
			branchId: branchId,
			onError: onError,
			checkpointInterval: 100,
		}),
	];
};
