import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keydownHandler } from 'prosemirror-keymap';
import { getPlugins } from './plugins';
import { renderStatic, buildSchema } from './utils';
import { useCollaborativeDoc } from './collaborative/useCollaborativeDoc';

require('./styles/base.scss');

const propTypes = {
	/* Object of custom nodes. To remove default node, override. For example, { image: null, header: null } */
	customNodes: PropTypes.object,
	customMarks: PropTypes.object,
	/* All customPlugins values should be a function, which is passed schema and props - and returns a Plugin */
	customPlugins: PropTypes.object,
	/* An object with nodeName keys and values of objects of overriding options. For example: nodeOptions = { image: { linkToSrc: false } } */
	nodeOptions: PropTypes.object,
	collaborativeOptions: PropTypes.object,
	onChange: PropTypes.func,
	onError: PropTypes.func,
	initialContent: PropTypes.object,
	placeholder: PropTypes.string,
	isReadOnly: PropTypes.bool,
	handleSingleClick: PropTypes.func,
	handleDoubleClick: PropTypes.func,
};

const defaultProps = {
	customNodes: {}, // defaults: 'blockquote', 'horizontal_rule', 'heading', 'ordered_list', 'bullet_list', 'list_item', 'code_block', 'text', 'hard_break', 'image'
	customMarks: {}, // defaults: 'em', 'strong', 'link', 'sub', 'sup', 'strike', 'code'
	customPlugins: {}, // defaults: inputRules, keymap, headerIds, placeholder
	nodeOptions: {},
	collaborativeOptions: {},
	onChange: () => {},
	onError: () => {},
	initialContent: { type: 'doc', attrs: { meta: {} }, content: [{ type: 'paragraph' }] },
	placeholder: '',
	isReadOnly: false,
	handleSingleClick: undefined,
	handleDoubleClick: undefined,
};

const createEditorState = (props, schema) =>
	EditorState.create({
		doc: schema.nodeFromJSON(props.initialContent),
		schema: schema,
		plugins: getPlugins(schema, {
			customPlugins: props.customPlugins,
			collaborativeOptions: props.collaborativeOptions,
			onChange: props.onChange,
			onError: props.onError,
			initialContent: props.initialContent,
			placeholder: props.placeholder,
			isReadOnly: props.isReadOnly,
		}),
	});

const createEditorView = (props, editorState, editorRef) =>
	new EditorView(
		{ mount: editorRef.current },
		{
			state: editorState,
			editable: () => false,
			handleKeyDown: keydownHandler({
				// Block Ctrl-S from launching the browser Save window
				'Mod-s': () => {
					return true;
				},
			}),
			handleClickOn: props.handleSingleClick,
			handleDoubleClickOn: props.handleDoubleClick,
		},
	);

const Editor = (props) => {
	const editorRef = useRef();
	const schema = useRef(null);
	const [view, setView] = useState(null);

	if (schema.current === null) {
		schema.current = buildSchema(props.customNodes, props.customMarks, props.nodeOptions);
	}

	const collabDoc = useCollaborativeDoc({
		firebaseRef: props.collaborativeOptions.firebaseRef,
		editorView: view,
		initialKey: props.collaborativeOptions.initialDocKey,
		prosemirrorSchema: schema.current,
	});

	const isReadOnly = props.isReadOnly || collabDoc.preventEditing;

	useEffect(() => {
		if (view) {
			view.setProps({
				editable: () => !(collabDoc.preventEditing || props.isReadOnly),
				dispatchTransaction: (transaction) => {
					const newState = view.state.apply(transaction);
					view.updateState(newState);
					collabDoc.sendCollabChanges();
				},
			});
		}
	}, [view, isReadOnly, collabDoc.sendCollabChanges]);

	useEffect(() => {
		const editorState = createEditorState(props, schema.current);
		setView(createEditorView(props, editorState, editorRef));
	}, []);

	/* Before createEditor is called from componentDidMount, we */
	/* generate a static version of the doc for server-side rendering. */
	/* This static version is overwritten when the editorView is */
	/* mounted into the editor dom node. */
	return (
		<div
			ref={editorRef}
			className={classNames('editor', 'ProseMirror', props.isReadOnly && 'read-only')}
		>
			{renderStatic(schema.current, props.initialContent.content, props)}
		</div>
	);
};

Editor.propTypes = propTypes;
Editor.defaultProps = defaultProps;
export default Editor;
