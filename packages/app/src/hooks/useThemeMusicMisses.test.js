import {renderHook, act} from '@testing-library/react';

import {useThemeMusic, forgetThemeMisses} from './useThemeMusic';

jest.mock('../context/SettingsContext', () => ({
	useSettings: () => ({settings: {themeMusicEnabled: true, themeMusicVolume: 30, themeMusicLoop: true}})
}));

const mockThemeSongs = jest.fn();
jest.mock('../services/jellyfinApi', () => ({
	getServerUrl: () => 'http://pi',
	getApiKey: () => 'key',
	getTokenParam: () => 'ApiKey',
	api: {getThemeSongs: (...args) => mockThemeSongs(...args)}
}));

beforeEach(() => {
	mockThemeSongs.mockReset();
	forgetThemeMisses();
	window.Audio = jest.fn(() => ({addEventListener: jest.fn(), pause: jest.fn(), set src (v) {}}));
});

test('a title the server says has no theme song is not asked about again', async () => {
	mockThemeSongs.mockResolvedValue({Items: []});
	const {result} = renderHook(() => useThemeMusic());
	await act(() => result.current.playThemeMusic('m1'));
	await act(() => result.current.playThemeMusic('m1'));
	await act(() => result.current.playThemeMusic('m1'));
	expect(mockThemeSongs).toHaveBeenCalledTimes(1);
});

test('a failed lookup is not remembered, so it is tried again', async () => {
	mockThemeSongs.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({Items: []});
	const {result} = renderHook(() => useThemeMusic());
	await act(() => result.current.playThemeMusic('m2'));
	await act(() => result.current.playThemeMusic('m2'));
	expect(mockThemeSongs).toHaveBeenCalledTimes(2);
});

test('a title with a theme song is looked up again on the next visit', async () => {
	mockThemeSongs.mockResolvedValue({Items: [{Id: 'song'}]});
	const {result} = renderHook(() => useThemeMusic());
	await act(() => result.current.playThemeMusic('m3'));
	act(() => result.current.stopThemeMusicImmediate());
	await act(() => result.current.playThemeMusic('m3'));
	expect(mockThemeSongs).toHaveBeenCalledTimes(2);
});
