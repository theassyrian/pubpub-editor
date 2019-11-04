import { Step } from 'prosemirror-transform';
import { compressStepJSON, uncompressStepJSON } from 'prosemirror-compress-pubpub';
import uuidv4 from 'uuid/v4';
import { firebaseTimestamp } from '../../utils';



export const createFirebaseAuthority = ({
	firebaseRef,
	prosemirrorSchema,
	initialKey,
	branchId,
}) => {
	let highestKnownKey = initialKey;
	let pendingCount = 0;

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
		const { committed } = await markPending(firebaseRef
			.child('changes')
			.child(highestKnownKey + 1)
			.transaction((remoteData) => {
				if (remoteData) {
					// Abort the transaction because there's already data on the remote at this key.
					// See https://firebase.google.com/docs/reference/js/firebase.database.Reference#transactionupdate:-function
					return undefined;
				}
				return createChangeForFirebase(steps, clientId, branchId);
			}));
		return committed;
	};

	const markPending = (promise) => {
		pendingCount += 1;
		promise
			.then((res) => {
				pendingCount -= 1;
				return res;
			})
			.catch((err) => {
				pendingCount -= 1;
				throw err;
			});
		return promise;
	};

	return {
		connect: connect,
		sendSteps: sendSteps,
		markPending: markPending,
		getPendingCount: () => pendingCount,
		getHighestKnownKey: () => highestKnownKey,
		getFirebaseRef: () => firebaseRef,
	};
};
