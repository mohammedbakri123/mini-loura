import { describe, expect, it } from "vitest";
import {
  ToolRegistry,
  ToolNotRegisteredError,
  ToolNotImplementedError,
  createDefaultToolRegistry,
} from "../../src/agent/tools.js";

describe("ToolRegistry", () => {
  it("lists declared tool definitions", () => {
    const registry = createDefaultToolRegistry();
    const names = registry.listDefinitions().map((t) => t.name);
    expect(names).toEqual([
      "getInventory",
      "getProduct",
      "getSuppliers",
      "getOpenOrders",
      "getPolicy",
      "createPurchaseOrder",
    ]);
  });

  it("exposes definitions but no arbitrary execution surface", () => {
    const registry = createDefaultToolRegistry();
    const definition = registry.getDefinition("getInventory");
    expect(definition).toBeDefined();
    expect(definition?.description).toBeTruthy();
  });

  it("throws when invoking an unregistered tool", async () => {
    const registry = new ToolRegistry();
    await expect(registry.invoke("dropDatabase", {})).rejects.toThrowError(
      ToolNotRegisteredError,
    );
  });

  it("throws when invoking a declared but unimplemented tool", async () => {
    const registry = createDefaultToolRegistry();
    await expect(registry.invoke("getInventory", { productId: "x" })).rejects.toThrowError(
      ToolNotImplementedError,
    );
  });

  it("invokes a registered handler", async () => {
    const registry = new ToolRegistry();
    registry.register({
      definition: { name: "echo", description: "test", inputExample: {} },
      handler: async (params) => params,
    });
    await expect(registry.invoke("echo", { hello: 1 })).resolves.toEqual({ hello: 1 });
  });
});
