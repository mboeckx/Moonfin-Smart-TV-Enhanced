import {render} from '@testing-library/react';

import {CurrentArtworkCard} from './ArtworkCard';

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

// The focus wrappers pull in a second copy of React under test, and only the image matters here.
jest.mock('./artworkSpottables', () => {
	const React = require('react');
	const Plain = ({children, ...props}) => React.createElement('div', props, children);
	return {SpottableDiv: Plain, SpottableButton: Plain};
});
jest.mock('@enact/i18n/$L', () => (text) => text);

const srcOf = (props) => render(<CurrentArtworkCard serverUrl="http://pi" itemId="m1" sizeClass="" {...props} />).container.querySelector('img').getAttribute('src');

test('each current backdrop asks for its own position', () => {
	expect(srcOf({category: 'Backdrop', tag: 'b0', index: 0})).toBe('http://pi/Items/m1/Images/Backdrop/0?maxWidth=400&tag=b0');
	expect(srcOf({category: 'Backdrop', tag: 'b2', index: 2})).toBe('http://pi/Items/m1/Images/Backdrop/2?maxWidth=400&tag=b2');
});

test('single-image kinds are asked for without a position, as before', () => {
	expect(srcOf({category: 'Primary', tag: 'p', index: 0})).toBe('http://pi/Items/m1/Images/Primary?maxWidth=400&tag=p');
	expect(srcOf({category: 'Logo', tag: 'l', index: 0})).toBe('http://pi/Items/m1/Images/Logo?maxWidth=400&tag=l');
});
