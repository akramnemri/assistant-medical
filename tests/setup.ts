import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library only auto-registers cleanup when a global `afterEach` exists,
// which Vitest provides only with `globals: true`. This project imports test
// helpers explicitly, so cleanup is registered here instead. Without it, DOM
// from a previous test leaks into the next one and queries match twice.
afterEach(cleanup);
