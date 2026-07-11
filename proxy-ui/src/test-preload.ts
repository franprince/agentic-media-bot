/**
 * Bun test preload for proxy-ui React component tests.
 * Sets up a jsdom DOM environment and extends expect with jest-dom matchers.
 *
 * Referenced in bunfig.toml via [test].preload.
 */
import { expect } from "bun:test";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { JSDOM } from "jsdom";

// Bootstrap jsdom
const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
	url: "http://localhost",
	pretendToBeVisual: true,
});

const { window } = dom;

// Expose browser globals
Object.assign(globalThis, {
	window,
	document: window.document,
	navigator: window.navigator,
	location: window.location,
	HTMLElement: window.HTMLElement,
	HTMLInputElement: window.HTMLInputElement,
	HTMLSelectElement: window.HTMLSelectElement,
	Element: window.Element,
	Node: window.Node,
	NodeList: window.NodeList,
	Event: window.Event,
	CustomEvent: window.CustomEvent,
	MutationObserver: window.MutationObserver,
	getComputedStyle: window.getComputedStyle.bind(window),
});

// Default no-op for scrollIntoView (tests can override per test)
window.HTMLElement.prototype.scrollIntoView = function () {};

// Extend bun's expect with jest-dom matchers (toBeInTheDocument, etc.)
expect.extend(jestDomMatchers as Parameters<typeof expect.extend>[0]);

// Automatically run cleanup after each test for React Testing Library
import { afterEach } from "bun:test";
const { cleanup } = require("@testing-library/react");

afterEach(() => {
	cleanup();
});



