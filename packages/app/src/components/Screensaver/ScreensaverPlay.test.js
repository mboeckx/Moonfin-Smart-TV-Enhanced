import {useRef} from 'react';
import {render, act} from '@testing-library/react';

import Screensaver from './Screensaver';
import useInactivityTimer from '../../hooks/useInactivityTimer';

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

// The screensaver as the app runs it: shown by the inactivity timer, whose wake listener hands
// it the presses made while it is up.
const Harness = ({hidden, ...props}) => {
	const keyRef = useRef(null);
	const {isInactive, dismiss} = useInactivityTimer(1, !hidden, keyRef);
	return <Screensaver visible={isInactive} keyHandlerRef={keyRef} onDismiss={dismiss} serverUrl="http://server" {...props} />;
};

const press = (type, keyCode = 13) => {
	const event = new window.KeyboardEvent(type, {bubbles: true, cancelable: true});
	Object.defineProperty(event, 'keyCode', {value: keyCode});
	const below = jest.fn();
	document.body.addEventListener(type, below);
	act(() => { document.body.dispatchEvent(event); });
	document.body.removeEventListener(type, below);
	return {event, reachedBelow: below.mock.calls.length > 0};
};

const startSaver = async () => {
	await act(async () => { jest.advanceTimersByTime(1000); });
};

const showBackdrop = async () => {
	await startSaver();
	// The first batch is asked for after two seconds and fades in half a second later.
	await act(async () => { jest.advanceTimersByTime(2100); });
	await act(async () => { await Promise.resolve(); await Promise.resolve(); });
	await act(async () => { jest.advanceTimersByTime(600); });
};

const saverUp = (container) => container.innerHTML.length > 0;

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('OK on a showing backdrop plays that title and keeps the press from the screen below', async () => {
	const onPlayItem = jest.fn();
	render(<Harness onPlayItem={onPlayItem} />);
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
	render(<Harness onPlayItem={onPlayItem} />);
	await startSaver();

	const down = press('keydown');
	expect(onPlayItem).not.toHaveBeenCalled();
	expect(down.reachedBelow).toBe(false);
	// The next press is the screen's again.
	expect(press('keydown').reachedBelow).toBe(true);
});

test('without a play handler, as in the player, OK just wakes the screen', async () => {
	render(<Harness />);
	await showBackdrop();
	expect(press('keydown').reachedBelow).toBe(false);
	expect(press('keydown').reachedBelow).toBe(true);
});

test('a hidden screensaver leaves OK alone', () => {
	const onPlayItem = jest.fn();
	render(<Harness hidden onPlayItem={onPlayItem} />);
	expect(press('keydown').reachedBelow).toBe(true);
	expect(onPlayItem).not.toHaveBeenCalled();
});

describe('coloured keys', () => {
	test('green and yellow hand the title on screen to the app, and the screensaver stays up', async () => {
		const onColorKey = jest.fn(async () => null);
		const {container} = render(<Harness onPlayItem={jest.fn()} onColorKey={onColorKey} />);
		await showBackdrop();
		const green = press('keydown', 404);
		expect(onColorKey).toHaveBeenLastCalledWith('green', expect.objectContaining({Id: MOVIE.Id}));
		expect(green.reachedBelow).toBe(false);
		expect(saverUp(container)).toBe(true);
		press('keydown', 405);
		expect(onColorKey).toHaveBeenLastCalledWith('yellow', expect.objectContaining({Id: MOVIE.Id}));
		expect(saverUp(container)).toBe(true);
	});

	test('the message the app hands back shows over the screensaver, then goes', async () => {
		const {container} = render(<Harness onPlayItem={jest.fn()} onColorKey={async () => 'Added to Watchlist: Some Film'} />);
		await showBackdrop();
		press('keydown', 404);
		await act(async () => { await Promise.resolve(); await Promise.resolve(); });
		expect(container.textContent).toContain('Added to Watchlist: Some Film');
		await act(async () => { jest.advanceTimersByTime(3600); });
		expect(container.textContent).not.toContain('Added to Watchlist');
	});

	test('before a title shows, the keys only wake the screen', async () => {
		const onColorKey = jest.fn();
		render(<Harness onColorKey={onColorKey} />);
		await startSaver();
		expect(press('keydown', 404).reachedBelow).toBe(false);
		expect(onColorKey).not.toHaveBeenCalled();
		expect(press('keydown', 404).reachedBelow).toBe(true);
	});
});
