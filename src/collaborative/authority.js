import { Step } from 'prosemirror-transform';
import { compressStepJSON, uncompressStepJSON } from 'prosemirror-compress-pubpub';
import uuidv4 from 'uuid/v4';
import { firebaseTimestamp } from '../utils';

const changesStartingFrom = (firebaseRef, startingKey) =>
	firebaseRef
		.child('changes')
		.orderByKey()
		.startAt(startingKey.toString());

/*
 * Given a snapshot of a subset of the changes on a branch from Firebase, provides a more structured
 * version of this data, extracting the steps and transforming them into Prosemirror objects,
 * providing an array with a corresponding clientId for every step, and the highest key found in the
 * subset of changes.
 */
const extractStepsFromFirebase = (firebaseChanges = {}, prosemirrorSchema) => {
	const steps = [];
	const clientIds = [];
	let highestKey = 0;
	Object.keys(firebaseChanges).forEach((key) => {
		const { s: compressedSteps, c: clientId } = firebaseChanges[key];
		const addedSteps = compressedSteps.map((cs) =>
			Step.fromJSON(prosemirrorSchema, uncompressStepJSON(cs)),
		);
		steps.push(...addedSteps);
		clientIds.push(...new Array(addedSteps.length).fill(clientId));
		highestKey = Math.max(highestKey, parseInt(key, 10));
	});
	return { steps: steps, clientIds: clientIds, highestKey: highestKey };
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

export const createFirebaseAuthority = ({
	firebaseRef,
	prosemirrorSchema,
	initialKey,
	branchId,
}) => {
	let highestKnownKey = initialKey;

	const handleReceivedSnapshot = (onReceiveSteps) => (snapshot) => {
		const { steps, clientIds, highestKey } = extractStepsFromFirebase(
			snapshot.val(),
			prosemirrorSchema,
		);
		highestKnownKey = highestKey;
		onReceiveSteps({ steps: steps, clientIds: clientIds, highestKey: highestKey });
	};

	const connect = async (onReceiveSteps) => {
		const changes = changesStartingFrom(firebaseRef, initialKey + 1);
		const snapshot = await changes.once('value');
		handleReceivedSnapshot(snapshot);
		changes.on('child_added', handleReceivedSnapshot(onReceiveSteps));
	};

	const sendSteps = async (steps, clientId) => {
		const { committed } = await firebaseRef
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

	return {
		connect: connect,
		sendSteps: sendSteps,
	};
};
