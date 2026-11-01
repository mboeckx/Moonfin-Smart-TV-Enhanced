import {renderHook, act} from '@testing-library/react';
import useInactivityTimer from './useInactivityTimer';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('wake answers true only while the screensaver is showing', () => {
	const {result, unmount} = renderHook(() => useInactivityTimer(10, true));
	expect(result.current.wake()).toBe(false);
	act(() => jest.advanceTimersByTime(10000));
	expect(result.current.isInactive).toBe(true);
	let woke;
	act(() => { woke = result.current.wake(); });
	expect(woke).toBe(true);
	expect(result.current.isInactive).toBe(false);
	expect(result.current.wake()).toBe(false);
	unmount();
});

test('the key that wakes the screensaver reaches no window listener added after it, and the next key does', () => {
	const {result, unmount} = renderHook(() => useInactivityTimer(10, true));
	act(() => jest.advanceTimersByTime(10000));
	const screen = jest.fn();
	window.addEventListener('keydown', screen, true);
	const press = () => {
		const event = new window.KeyboardEvent('keydown', {bubbles: true, cancelable: true});
		act(() => { document.body.dispatchEvent(event); });
		return event;
	};
	expect(press().defaultPrevented).toBe(true);
	expect(screen).not.toHaveBeenCalled();
	expect(result.current.isInactive).toBe(false);
	expect(press().defaultPrevented).toBe(false);
	expect(screen).toHaveBeenCalledTimes(1);
	window.removeEventListener('keydown', screen, true);
	unmount();
});

test('Search text interaction resets the existing timer rather than adding one', () => {
	const {result, unmount} = renderHook(() => useInactivityTimer(10, true));
	act(() => jest.advanceTimersByTime(9000));
	act(() => result.current.dismiss());
	act(() => jest.advanceTimersByTime(2000));
	expect(result.current.isInactive).toBe(false);
	act(() => jest.advanceTimersByTime(8000));
	expect(result.current.isInactive).toBe(true);
	unmount();
	expect(jest.getTimerCount()).toBe(0);
});

test('a key the screensaver uses is handed to it and does not wake it', () => {
	const intercept = {current: jest.fn((e) => e.keyCode === 404)};
	const {result, unmount} = renderHook(() => useInactivityTimer(10, true, intercept));
	act(() => jest.advanceTimersByTime(10000));
	const press = (keyCode) => {
		const event = new window.KeyboardEvent('keydown', {bubbles: true, cancelable: true});
		Object.defineProperty(event, 'keyCode', {value: keyCode});
		act(() => { document.body.dispatchEvent(event); });
		return event;
	};
	expect(press(404).defaultPrevented).toBe(true);
	expect(result.current.isInactive).toBe(true);
	expect(press(13).defaultPrevented).toBe(true);
	expect(result.current.isInactive).toBe(false);
	// Awake, the handler is not asked.
	intercept.current.mockClear();
	press(404);
	expect(intercept.current).not.toHaveBeenCalled();
	unmount();
});
