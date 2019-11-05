import { collab } from 'prosemirror-collab';

import { generateHash } from '../../utils';

import { createDocumentPlugin } from './document';

// const transactionContainsInvalidKeys = (transaction) => {
// 	const validMetaKeys = ['history$', 'paste', 'uiEvent'];
// 	return Object.keys(transaction.meta).some((key) => {
// 		const keyIsValid = validMetaKeys.includes(key);
// 		return !keyIsValid;
// 	});
// };

export default (schema, props) => {
	const { collaborativeOptions } = props;
	if (collaborativeOptions) {
		const { clientData = {} } = collaborativeOptions;
		const localClientId = `${clientData.id}-${generateHash(6)}`;
		return [collab({ clientID: localClientId }), createDocumentPlugin(schema, props)];
	}
	return [];
};
