/* A React hooks wrapper for the collab code, to make the Editor.js file a little more idiomatic. */
import { useState, useEffect } from 'react';

import createCollabState, { Status } from './collaborativeDoc';

export const useCollaborativeDoc = ({ firebaseRef, editorView, initialKey, prosemirrorSchema }) => {
	const [collabState, setCollabState] = useState(null);
	const [status, setStatus] = useState(null);

	useEffect(() => {
		if (editorView) {
			setCollabState(
				createCollabState({
					editorView: editorView,
					firebaseRef: firebaseRef,
					initialKey: initialKey,
					prosemirrorSchema: prosemirrorSchema,
					onStateChange: (state) => setStatus(state.status),
				}),
			);
		}
	}, [editorView]);

	return {
		preventEditing: firebaseRef && (!status || status === Status.LOADING),
		...collabState,
	};
};
