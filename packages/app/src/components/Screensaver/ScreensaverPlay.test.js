import {render, act} from '@testing-library/react';

import Screensaver from './Screensaver';

// The CLI ships a second copy of React, so the components' JSX goes through the copy under test.
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

const MOVIE = {Id: 'm1', Name: 'Some Film', Type: 'Movie', BackdropImageTags: ['b1']};

jest.mock('../../services/jellyfinApi', () => ({
	api: {
		getAllLibraries: async () => ({Items: [{Id: 'lib', CollectionType: 'movies'}]}),
		getItems: async () => ({Items: [{Id: 'm1', Name: 'Some Film', Type: 'Movie', BackdropImageTags: ['b1']}]})
	}
}));
jest.mock('../../utils/logoAutocrop', () => ({autocropLogoUrl: async () => null}));

const press = (type) => {
	const event = new window.KeyboardEvent(type, {keyCode: 13, bubbles: true, cancelable: true});
	Object.defineProperty(event, 'keyCode', {value: 13});
	const below = jest.fn();
	document.body.addEventListener(type, below);
	document.body.dispatchEvent(event);
	document.body.removeEventListener(type, below);
	return {event, reachedBelow: below.mock.calls.length > 0};
};

const showBackdrop = async () => {
	// The first batch is asked for after two seconds and fades in half a second later.
	await act(async () => { jest.advanceTimersByTime(2100); });
	await act(async () => { await Promise.resolve(); await Promise.resolve(); });
	await act(async () => { jest.advanceTimersByTime(600); });
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('OK on a showing backdrop plays that title and keeps the press from the screen below', async () => {
	const onPlayItem = jest.fn();
	const onDismiss = jest.fn();
	render(<Screensaver visible onPlayItem={onPlayItem} onDismiss={onDismiss} serverUrl="http://server" />);
	await showBackdrop();

	const down = press('keydown');
	expect(onPlayItem).toHaveBeenCalledWith(expect.objectContaining({Id: MOVIE.Id}));
	expect(down.event.defaultPrevented).toBe(true);
	expect(down.reachedBelow).toBe(false);

	const up = press('keyup');
	expect(up.reachedBelow).toBe(false);
	// Only the one keyup is held back.
	expect(press('keyup').reachedBelow).toBe(true);
});

test('OK before a backdrop shows only wakes the screen', async () => {
	const onPlayItem = jest.fn();
	const onDismiss = jest.fn();
	render(<Screensaver visible onPlayItem={onPlayItem} onDismiss={onDismiss} serverUrl="http://server" />);

	const down = press('keydown');
	expect(onPlayItem).not.toHaveBeenCalled();
	expect(onDismiss).toHaveBeenCalled();
	expect(down.reachedBelow).toBe(false);
});

test('without a play handler, as in the player, OK behaves as before', async () => {
	const onDismiss = jest.fn();
	render(<Screensaver visible onDismiss={onDismiss} serverUrl="http://server" />);
	await showBackdrop();
	expect(press('keydown').reachedBelow).toBe(true);
});

test('a hidden screensaver leaves OK alone', () => {
	const onPlayItem = jest.fn();
	render(<Screensaver visible={false} onPlayItem={onPlayItem} serverUrl="http://server" />);
	expect(press('keydown').reachedBelow).toBe(true);
	expect(onPlayItem).not.toHaveBeenCalled();
});

const pressKey = (keyCode) => {
	const event = new window.KeyboardEvent('keydown', {bubbles: true, cancelable: true});
	Object.defineProperty(event, 'keyCode', {value: keyCode});
	const below = jest.fn();
	const otherWindowListener = jest.fn();
	window.addEventListener('keydown', otherWindowListener, true);
	document.body.addEventListener('keydown', below);
	document.body.dispatchEvent(event);
	document.body.removeEventListener('keydown', below);
	window.removeEventListener('keydown', otherWindowListener, true);
	return {reachedBelow: below.mock.calls.length > 0, reachedOtherWindowListeners: otherWindowListener.mock.calls.length > 0};
};

describe('coloured keys', () => {
	test('green and yellow hand the title on screen to the app and stop there', async () => {
		const onColorKey = jest.fn(async () => null);
		render(<Screensaver visible onPlayItem={jest.fn()} onColorKey={onColorKey} serverUrl="http://server" />);
		await showBackdrop();
		const green = pressKey(404);
		expect(onColorKey).toHaveBeenLastCalledWith('green', expect.objectContaining({Id: MOVIE.Id}));
		// Not even the inactivity listener sees it, so the screensaver stays up.
		expect(green.reachedBelow).toBe(false);
		expect(green.reachedOtherWindowListeners).toBe(false);
		pressKey(405);
		expect(onColorKey).toHaveBeenLastCalledWith('yellow', expect.objectContaining({Id: MOVIE.Id}));
	});

	test('the message the app hands back shows over the screensaver, then goes', async () => {
		const {container} = render(<Screensaver visible onPlayItem={jest.fn()} onColorKey={async () => 'Added to Watchlist: Some Film'} serverUrl="http://server" />);
		await showBackdrop();
		pressKey(404);
		await act(async () => { await Promise.resolve(); await Promise.resolve(); });
		expect(container.textContent).toContain('Added to Watchlist: Some Film');
		await act(async () => { jest.advanceTimersByTime(4000); });
		expect(container.textContent).not.toContain('Added to Watchlist');
	});

	test('before a title shows, or without a handler, the keys behave as before', async () => {
		const onColorKey = jest.fn();
		render(<Screensaver visible onColorKey={onColorKey} serverUrl="http://server" />);
		expect(pressKey(404).reachedBelow).toBe(true);
		expect(onColorKey).not.toHaveBeenCalled();
	});
});
