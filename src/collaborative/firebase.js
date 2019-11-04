import { Step } from 'prosemirror-transform';
import { compressStepJSON, uncompressStepJSON } from 'prosemirror-compress-pubpub';
import uuidv4 from 'uuid/v4';

import { firebaseTimestamp } from '../utils';

const getBranchIdFromRef = (ref) => ref.key.replace('branch-', '');

const extractStepsFromFirebaseChange = (key, firebaseChange, prosemirrorSchema) => {
	const { s: compressedSteps, cId: clientId } = firebaseChange;
	const steps = compressedSteps.map((cs) =>
		Step.fromJSON(prosemirrorSchema, uncompressStepJSON(cs)),
	);
	return {
		steps: steps,
		clientIds: new Array(steps.length).fill(clientId),
		key: parseInt(key, 10),
	};
};

const createChangeForFirebase = (steps, clientId, branchId) => {
	return {
		id: uuidv4(),
		cId: clientId,
		bId: branchId,
		s: steps.map((step) => compressStepJSON(step.toJSON())),
		t: firebaseTimestamp,
	};
};

const changesStartingFrom = (ref, startingKey) =>
	ref
		.child('changes')
		.orderByKey()
		.startAt(startingKey.toString());

export const getHighestKeyFromChanges = (changes) =>
	changes.map((c) => c.highestKey).reduce((a, b) => Math.max(a, b));

export const receiveInitialChanges = async (ref, startingKey, prosemirrorSchema) => {
	const changes = changesStartingFrom(ref, startingKey);
	const snapshot = await changes.once('value');
	const snapshotVal = snapshot.val() || {};
	const steps = [];
	const clientIds = [];
	let highestKnownKey = startingKey;
	Object.keys(snapshotVal).forEach((key) => {
		const extracted = extractStepsFromFirebaseChange(key, snapshotVal[key], prosemirrorSchema);
		steps.push(...extracted.steps);
		clientIds.push(...extracted.clientIds);
		highestKnownKey = Math.max(extracted.key, highestKnownKey);
	});
	return { steps: steps, clientIds: clientIds, highestKey: highestKnownKey };
};

export const receiveCollabChanges = (ref, startingKey, prosemirrorSchema, onReceiveChange) =>
	changesStartingFrom(ref, startingKey + 1).on('child_added', (changeSnapshot) => {
		const { steps, clientIds, key } = extractStepsFromFirebaseChange(
			changeSnapshot.key,
			changeSnapshot.val() || {},
			prosemirrorSchema,
		);
		onReceiveChange({ steps: steps, clientIds: clientIds, highestKey: key });
	});

export const sendSteps = async (ref, steps, clientId, highestKnownKey) => {
	const branchId = getBranchIdFromRef(ref);
	const { committed } = await ref
		.child('changes')
		.child(highestKnownKey + 1)
		.transaction((remoteData) => {
			if (remoteData) {
				// Abort the transaction because there's already data on the remote at this key.
				// See https://firebase.google.com/docs/reference/js/firebase.database.Reference#transactionupdate:-function
				return undefined;
			}
			return createChangeForFirebase(steps, clientId, branchId);
		});
	return committed;
};
