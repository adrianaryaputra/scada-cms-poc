// js/__tests__/config.test.js

import { GRID_SIZE } from "../config.js";

describe("Config", () => {
    describe("GRID_SIZE", () => {
        test("should be defined", () => {
            expect(GRID_SIZE).toBeDefined();
        });

        test("should be a number", () => {
            expect(typeof GRID_SIZE).toBe("number");
        });

        test("should be a positive value", () => {
            expect(GRID_SIZE).toBeGreaterThan(0);
        });

        test("should have the expected value (e.g., 20)", () => {
            // This test is a bit brittle if the value changes often,
            // but good for ensuring it's not accidentally changed to something unexpected.
            expect(GRID_SIZE).toBe(20);
        });
    });

    // If other constants were added to config.js, similar test blocks would be created for them.
    // For example:
    // describe("API_URL", () => {
    //     test("should be defined and be a non-empty string", () => {
    //         expect(API_URL).toBeDefined();
    //         expect(typeof API_URL).toBe("string");
    //         expect(API_URL.length).toBeGreaterThan(0);
    //     });
    // });
});
