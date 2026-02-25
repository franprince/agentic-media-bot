import { describe, expect, test } from "bun:test";
import { hasExplicitAddIntent, isDetailsIntent, shouldDisableAddActions } from "../intent";

describe("intent helpers", () => {
    test("detects details intent in Spanish", () => {
        expect(isDetailsIntent("Dame mas detalles de Esperando la carroza")).toBe(true);
        expect(isDetailsIntent("Quiero la sinopsis de Ran")).toBe(true);
    });

    test("detects explicit add intent", () => {
        expect(hasExplicitAddIntent("agrega Esperando la carroza")).toBe(true);
        expect(hasExplicitAddIntent("please add movie Ran")).toBe(true);
    });

    test("disables add actions for details-only requests", () => {
        expect(shouldDisableAddActions("Dame mas detalles de Esperando la carroza")).toBe(true);
        expect(shouldDisableAddActions("agrega Esperando la carroza")).toBe(false);
        expect(shouldDisableAddActions("Dame mas detalles y agregala")).toBe(false);
    });
});

