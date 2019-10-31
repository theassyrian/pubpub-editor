import { Plugin, Selection, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { sendableSteps } from 'prosemirror-collab';
import { uncompressSelectionJSON } from 'prosemirror-compress-pubpub';
import { transactionAggregator } from './transactionAggregator';

const discussionsPluginKey = new PluginKey('discussions');

const isDiscussionWidgetDecoration = (deco) => deco.spec.key.indexOf('discussion-widget-') === -1;

const getIdFromDecoration = (deco) =>
	deco.spec.key.replace('discussion-inline-', '').replace('discussion-widget-', '');

const getSelectionForDiscussion = (editorState, discussionData) => {
	try {
		return Selection.fromJSON(
			editorState.doc,
			uncompressSelectionJSON(discussionData.selection),
		);
	} catch (_) {
		return null;
	}
};

const createDecorationsForDiscussion = (discussionData, selection) => {
	const { id } = discussionData;
	const highlightTo = selection.to;
	const elem = document.createElement('span');
	elem.className = `discussion-mount dm-${id}`;
	const inlineDecoration = Decoration.inline(
		selection.from,
		selection.to,
		{ class: `discussion-range d-${id}` },
		{ key: `discussion-inline-${id}` },
	);
	const widgetDecoration = Decoration.widget(highlightTo, elem, {
		stopEvent: () => {
			return true;
		},
		key: `discussion-widget-${id}`,
		marks: [],
	});
	return [inlineDecoration, widgetDecoration];
};

const getDecorationsToRemove = (updates, decorations) => {
	if (!updates) {
		return [];
	}
	return decorations
		.find()
		.filter((deco) =>
			updates.some(
				({ type, data }) =>
					type === 'removeDiscussion' && data.id === getIdFromDecoration(deco),
			),
		);
};

const getDecorationsToAdd = (updates, editorState, prevDecorations, highestKnownKey) => {
	if (!updates) {
		return [];
	}
	return updates
		.filter((update) => update.type === 'setDiscussion')
		.map((discussion) => {
			const alreadyHandled = prevDecorations
				.find()
				.some((decoration) => getIdFromDecoration(decoration) === discussion.id);
			const selection = getSelectionForDiscussion(editorState, discussion);
			if (!alreadyHandled && selection && discussion.currentKey === highestKnownKey) {
				return createDecorationsForDiscussion(discussion, selection);
			}
			return [];
		})
		.reduce((a, b) => [...a, ...b], []);
};

const persistDiscussions = (authority, discussionDecorations) => {
	const { markPending, getHighestKnownKey, getFirebaseRef } = authority;
	const highestKnownKey = getHighestKnownKey();

	const txBody = (decoration, existingDiscussion) => {
		if (existingDiscussion && existingDiscussion.currentKey > highestKnownKey) {
			return undefined;
		}
		return {
			...existingDiscussion,
			currentKey: highestKnownKey,
			selection: {
				a: decoration.from,
				h: decoration.to,
				t: 'text',
			},
		};
	};

	discussionDecorations
		.find()
		.filter(isDiscussionWidgetDecoration)
		.forEach((decoration) =>
			markPending(
				getFirebaseRef()
					.child('discussions')
					.child(getIdFromDecoration(decoration))
					.transaction((existingData) => txBody(decoration, existingData)),
			),
		);
};

// TODO(ian): Checking sendableSteps?
export default (_, { authority }) => {
	const updateState = (transaction, pluginState, __, editorState) => {
		const { discussionDecorations } = pluginState;
		const updates = transaction.getMeta(discussionsPluginKey) || [];
		const decorationsToRemove = getDecorationsToRemove(updates, discussionDecorations);
		const decorationsToAdd = getDecorationsToAdd(updates, editorState, discussionDecorations);
		const nextDiscussionDecorations = discussionDecorations
			.remove(decorationsToRemove)
			.map(transaction.mapping, transaction.doc)
			.add(editorState.doc, decorationsToAdd);
		// TODO(ian): do this more carefully
		if (transaction.meta.collab$) {
			persistDiscussions(authority, nextDiscussionDecorations);
		}
		return { discussionDecorations: nextDiscussionDecorations };
	};

	const createView = (editorView) => {
		const aggregator = transactionAggregator(editorView, discussionsPluginKey);
		const createDecoTrans = (type) => {
			return (snapshot) => {
				aggregator.enqueue({
					type: type,
					data: { ...snapshot.val(), id: snapshot.key },
				});
			};
		};
		const ref = authority.getFirebaseRef().child('discussions');
		ref.on('child_added', createDecoTrans('setDiscussion'));
		ref.on('child_changed', createDecoTrans('setDiscussion'));
		ref.on('child_removed', createDecoTrans('removeDiscussion'));
	};

	const state = {
		init: (__, editorState) => {
			return {
				discussionDecorations: DecorationSet.create(editorState.doc, []),
			};
		},
		update: updateState,
	};

	const props = {
		decorations: (editorState) => {
			const discussionDecorations = discussionsPluginKey
				.getState(editorState)
				.discussionDecorations.find();
			return DecorationSet.create(editorState.doc, discussionDecorations);
		},
	};

	return new Plugin({
		key: discussionsPluginKey,
		state: state,
		view: createView,
		props: props,
	});
};
