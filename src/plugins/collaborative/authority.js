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

export const createFirebaseAuthority = ({
	firebaseRef,
	prosemirrorSchema,
	initialKey,
	branchId,
}) => {
	let highestKnownKey = initialKey;

	const handleInitialSnapshot = (changesSnapshot, onReceiveSteps) => {
		const snapshotVal = changesSnapshot.val() || {};
		const steps = [];
		const clientIds = [];
		Object.keys(snapshotVal).forEach((key) => {
			const extracted = extractStepsFromFirebaseChange(
				key,
				snapshotVal[key],
				prosemirrorSchema,
			);
			steps.push(...extracted.steps);
			clientIds.push(...extracted.clientIds);
			highestKnownKey = Math.max(extracted.key, highestKnownKey);
		});
		onReceiveSteps({ steps: steps, clientIds: clientIds, highestKey: highestKnownKey });
	};

	const handleReceivedSnapshot = (changeSnapshot, onReceiveSteps) => {
		const { steps, clientIds, key } = extractStepsFromFirebaseChange(
			changeSnapshot.key,
			changeSnapshot.val() || {},
			prosemirrorSchema,
		);
		highestKnownKey = Math.max(highestKnownKey, key);
		onReceiveSteps({ steps: steps, clientIds: clientIds, highestKey: highestKnownKey });
	};

	const connect = async (onReceiveSteps) => {
		const changes = changesStartingFrom(firebaseRef, initialKey + 1);
		const changesSnapshot = await changes.once('value');
		handleInitialSnapshot(changesSnapshot, onReceiveSteps);
		changesStartingFrom(firebaseRef, highestKnownKey + 1).on('child_added', (snapshot) =>
			handleReceivedSnapshot(snapshot, onReceiveSteps),
		);
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
