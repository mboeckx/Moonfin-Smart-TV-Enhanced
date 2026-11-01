import {render, act} from '@testing-library/react';

import Screensaver, {pickBackdrop, forgetRecentlyShown} from './Screensaver';

jest.mock('react/jsx-dev-runtime', () => {
	const React = require('react');
	return {
		jsxDEV: (type, {children, ...props}, key, isStaticChildren) => {
			const config = key === undefined ? props : {...props, key};
			if (children === undefined) return React.createElement(type, config);
			return isStaticChildren ? React.createElement(type, config, ...children) : React.createElement(type, config, children);
		}
	};
});

const mockRequests = [];
const mockLibrary = Array.from({length: 80}, (_, i) => ({Id: `m${i}`, Name: `Film ${i}`, Type: 'Movie', BackdropImageTags: ['t0', 't1', 't2']}));
jest.mock('../../services/jellyfinApi', () => ({
	api: {
		getAllLibraries: async () => ({Items: [{Id: 'lib', CollectionType: 'movies'}]}),
		getItems: async (params) => {
			mockRequests.push(params);
			return {Items: mockLibrary.slice(0, params.Limit)};
		}
	}
}));
jest.mock('../../utils/logoAutocrop', () => ({autocropLogoUrl: async () => null}));

const startScreensaver = async (props) => {
	const view = render(<Screensaver visible serverUrl="http://pi" {...props} />);
	await act(async () => { jest.advanceTimersByTime(2100); });
	await act(async () => { await Promise.resolve(); await Promise.resolve(); });
	await act(async () => { jest.advanceTimersByTime(600); });
	return view;
};

beforeEach(() => {
	jest.useFakeTimers();
	mockRequests.length = 0;
	forgetRecentlyShown();
});
afterEach(() => jest.useRealTimers());

test('shuffle asks the server for a random draw from the whole library', async () => {
	await startScreensaver({shuffleLibrary: true});
	expect(mockRequests[0]).toEqual(expect.objectContaining({SortBy: 'Random', StartIndex: 0, ParentId: 'lib'}));
});

test('with shuffle off it uses the original sorted selection', async () => {
	await startScreensaver({shuffleLibrary: false});
	expect(['DateCreated', 'CommunityRating']).toContain(mockRequests[0].SortBy);
	expect(['Ascending', 'Descending']).toContain(mockRequests[0].SortOrder);
});

test('the backdrop url names one of the title\'s backdrops and carries its tag', async () => {
	const {container} = await startScreensaver({shuffleLibrary: true});
	const style = container.querySelector('[style*="Backdrop"]').getAttribute('style');
	expect(style).toMatch(/\/Images\/Backdrop\/[012]\?.*tag=t[012]/);
	const [, index, tag] = /Backdrop\/(\d)\?.*tag=t(\d)/.exec(style);
	expect(index).toBe(tag);
});

describe('picking a backdrop', () => {
	test('shuffle spreads over all of a title\'s backdrops', () => {
		const item = {Id: 'm', BackdropImageTags: ['a', 'b', 'c']};
		const seen = new Set();
		for (let i = 0; i < 200; i++) seen.add(pickBackdrop(item, true).index);
		expect([...seen].sort()).toEqual([0, 1, 2]);
	});
	test('shuffle picks from however many backdrops a title has, one or many', () => {
		expect(pickBackdrop({Id: 'one', BackdropImageTags: ['only']}, true)).toEqual({id: 'one', index: 0, tag: 'only'});
		const seven = {Id: 'seven', BackdropImageTags: ['t0', 't1', 't2', 't3', 't4', 't5', 't6']};
		const seen = new Set();
		for (let i = 0; i < 500; i++) {
			const pick = pickBackdrop(seven, true);
			expect(pick.tag).toBe(`t${pick.index}`);
			seen.add(pick.index);
		}
		expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
	});
	test('without shuffle it is always the first, as before', () => {
		expect(pickBackdrop({Id: 'm', BackdropImageTags: ['a', 'b']}, false)).toEqual({id: 'm', index: 0, tag: 'a'});
	});
	test('an episode without its own backdrop uses its parent\'s', () => {
		expect(pickBackdrop({Id: 'e', ParentBackdropItemId: 's', ParentBackdropImageTags: ['p']}, true)).toEqual({id: 's', index: 0, tag: 'p'});
	});
	test('nothing to show gives nothing', () => {
		expect(pickBackdrop({Id: 'x'}, true)).toBeNull();
	});
});
