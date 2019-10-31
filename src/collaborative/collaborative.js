import { Plugin, PluginKey } from 'prosemirror-state';
import { collab, receiveTransaction, sendableSteps } from 'prosemirror-collab';

import { generateHash } from '../utils';

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
	const { authority, branchId } = collaborativePluginKey.getState(editorView.state);
	const editable = editorView.props.editable(editorView.state);
	const sendable = sendableSteps(editorView.state);
	if (sendable && editable && !transactionContainsInvalidKeys(transaction)) {
		await authority.sendSteps(sendable.version, sendable.steps, sendable.clientID, branchId);
	}
};

const createFirebaseCollabPlugin = ({ firebaseRef, prosemirrorSchema, initialKey, branchId }) => {
	const authority = createFirebaseAuthority({
		firebaseRef: firebaseRef,
		initialKey: initialKey,
		prosemirrorSchema: prosemirrorSchema,
		branchId: branchId,
	});

	const setupView = (editorView) => {
		authority
			.connect(({ steps, clientIds }) =>
				receiveTransaction(editorView.state, steps, clientIds),
			)
			.then(() => {
				const connectedTransaction = editorView.state.tr;
				connectedTransaction.setMeta('connectedToFirebase', true);
				editorView.dispatch(connectedTransaction);
			});
	};

	return new Plugin({
		key: collaborativePluginKey,
		props: {
			editable: (state) => collaborativePluginKey.getState(state).isConnected,
		},
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

export default (schema, { collaborativeOptions = {} }) => {
	const { firebaseRef, initialKey, clientData } = collaborativeOptions;
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
			initialKey: initialKey,
			branchId: branchId,
		}),
	];
};
