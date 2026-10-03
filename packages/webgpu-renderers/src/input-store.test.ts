import { beforeEach, describe, expect, it, vi } from "vitest";

// Variables referenced in vi.mock must be prefixed with "mock" in Vitest
const mockDispose = vi.fn();
const mockState = {
	inputConstructorCallCount: 0,
	urlSourceConstructorCallCount: 0,
	lastUrlSourceUrl: "",
	filePathSourceConstructorCallCount: 0,
	lastFilePathSourcePath: "",
	mockImplementationOnceFn: null as (() => void) | null,
};

// Mock mediabunny package by declaring mock classes inside the factory to prevent TDZ errors
vi.mock("mediabunny", () => {
	class MockUrlSource {
		url: string;
		constructor(url: string) {
			mockState.urlSourceConstructorCallCount++;
			mockState.lastUrlSourceUrl = url;
			this.url = url;
		}
	}

	class MockInput {
		constructor() {
			mockState.inputConstructorCallCount++;
			if (mockState.mockImplementationOnceFn) {
				const fn = mockState.mockImplementationOnceFn;
				mockState.mockImplementationOnceFn = null;
				fn();
			}
		}

		dispose() {
			mockDispose();
		}
	}

	class MockFilePathSource {
		path: string;
		constructor(path: string) {
			mockState.filePathSourceConstructorCallCount++;
			mockState.lastFilePathSourcePath = path;
			this.path = path;
		}
	}

	return {
		ALL_FORMATS: ["test-format"],
		FilePathSource: MockFilePathSource,
		Input: MockInput,
		UrlSource: MockUrlSource,
	};
});

// Import after the mock setup
import { inputStore } from "./input-store.js";

describe("InputStore", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDispose.mockClear();
		mockState.inputConstructorCallCount = 0;
		mockState.urlSourceConstructorCallCount = 0;
		mockState.lastUrlSourceUrl = "";
		mockState.filePathSourceConstructorCallCount = 0;
		mockState.lastFilePathSourcePath = "";
		mockState.mockImplementationOnceFn = null;

		// Reset the internal store of the singleton inputStore
		(inputStore as any).store.clear();
	});

	it("should acquire an Input using FilePathSource for local file paths in Node", async () => {
		const filePath = "/path/to/video%20file.mp4";
		const input = await inputStore.acquire(filePath);

		expect(mockState.filePathSourceConstructorCallCount).toBe(1);
		expect(mockState.lastFilePathSourcePath).toBe("/path/to/video file.mp4");
		expect(mockState.inputConstructorCallCount).toBe(1);
		expect(input).toBeDefined();
	});

	it("should acquire an Input using FilePathSource for file:// URLs in Node", async () => {
		const fileUrl = "file:///path/to/video.mp4";
		const input = await inputStore.acquire(fileUrl);

		expect(mockState.filePathSourceConstructorCallCount).toBe(1);
		expect(mockState.lastFilePathSourcePath).toBe("/path/to/video.mp4");
		expect(mockState.inputConstructorCallCount).toBe(1);
		expect(input).toBeDefined();
	});

	it("should acquire an Input for a given URL", async () => {
		const url = "http://example.com/video.mp4";
		const input = await inputStore.acquire(url);

		expect(mockState.urlSourceConstructorCallCount).toBe(1);
		expect(mockState.lastUrlSourceUrl).toBe(url);
		expect(mockState.inputConstructorCallCount).toBe(1);
		expect(input).toBeDefined();
		expect(input.constructor.name).toBe("MockInput");
	});

	it("should cache and return the same Promise for concurrent and subsequent acquisitions of the same URL", async () => {
		const url = "http://example.com/video.mp4";

		const p1 = inputStore.acquire(url);
		const p2 = inputStore.acquire(url);

		const [input1, input2] = await Promise.all([p1, p2]);
		expect(input1).toBe(input2);
		expect(mockState.inputConstructorCallCount).toBe(1);

		// Subsequent acquisition
		const input3 = await inputStore.acquire(url);
		expect(input3).toBe(input1);
		expect(mockState.inputConstructorCallCount).toBe(1);
	});

	it("should decrement refCount on release and dispose input when refCount reaches 0", async () => {
		const url = "http://example.com/video.mp4";

		await inputStore.acquire(url); // refCount = 1
		await inputStore.acquire(url); // refCount = 2

		// Release 1 - shouldn't dispose
		inputStore.release(url);
		expect(mockDispose).not.toHaveBeenCalled();

		// Release 2 - refCount = 0, should dispose
		inputStore.release(url);

		// Wait for microtask queue to process the .then() in release
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(mockDispose).toHaveBeenCalledTimes(1);
	});

	it("should handle releasing a non-existent or empty URL safely", () => {
		expect(() => inputStore.release("")).not.toThrow();
		expect(() => inputStore.release("non-existent")).not.toThrow();
	});

	it("should throw an error for an empty URL", async () => {
		await expect(inputStore.acquire("")).rejects.toThrow(
			"Cannot acquire Input for empty URL",
		);
	});

	it("should remove url from store and throw if Input constructor fails", async () => {
		const failingUrl = "http://example.com/fail.mp4";

		// Mock Input to throw an error just for this call
		mockState.mockImplementationOnceFn = () => {
			throw new Error("Mediabunny creation failed");
		};

		await expect(inputStore.acquire(failingUrl)).rejects.toThrow(
			"Mediabunny creation failed",
		);

		// Verify it was removed from the store, so subsequent call tries to create it again
		expect((inputStore as any).store.has(failingUrl)).toBe(false);
	});
});
