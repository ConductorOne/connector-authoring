import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractField, normalizeTranscript, normalizeToolName } from "../src/transcript.ts";

describe("normalizeToolName", () => {
  it("strips MCP prefixes", () => {
    assert.equal(normalizeToolName("mcp__c1dev__c1_apps_create"), "c1_apps_create");
    assert.equal(normalizeToolName("mcp__other__c1_connector_service_get"), "c1_connector_service_get");
    assert.equal(normalizeToolName("c1_apps_create"), "c1_apps_create");
    assert.equal(normalizeToolName("bash"), "bash");
  });
});

describe("normalizeTranscript", () => {
  it("pairs tool calls with results by id", () => {
    const t = normalizeTranscript([
      { type: "tool_call", id: "a", tool: "mcp__c1dev__c1_connector_authoring_create_draft", input: { connectorName: "x" } },
      { type: "tool_call", id: "b", tool: "mcp__c1dev__c1_apps_create", input: { displayName: "y" } },
      { type: "tool_result", tool_call_id: "b", content: '{"app":{"id":"app9"}}' },
      { type: "tool_result", tool_call_id: "a", content: '{"catalogId":"cat1","draft":{"id":"dr1"}}' },
    ]);
    assert.equal(t.calls.length, 2);
    assert.equal(t.calls[0].tool, "c1_connector_authoring_create_draft");
    assert.equal(t.calls[0].resultText, '{"catalogId":"cat1","draft":{"id":"dr1"}}');
    assert.equal(t.calls[1].tool, "c1_apps_create");
    assert.equal(t.calls[1].resultText, '{"app":{"id":"app9"}}');
  });

  it("marks error results as failed calls", () => {
    const t = normalizeTranscript([
      { type: "tool_use", id: "a", name: "c1_connector_authoring_get_run", arguments: { runId: "r1" } },
      { type: "tool_result", tool_call_id: "a", is_error: true, content: "tool not found" },
    ]);
    assert.equal(t.calls[0].ok, false);
    assert.equal(t.calls[0].errorText, "tool not found");
  });

  it("handles string-JSON arguments and claude content blocks", () => {
    const t = normalizeTranscript([
      { type: "tool_call", tool: "c1_apps_create", args: '{"displayName":"z"}' },
      { type: "tool_result", result: [{ type: "text", text: '{"app":{"id":"a1"}}' }] },
    ]);
    assert.deepEqual(t.calls[0].args, { displayName: "z" });
    assert.equal(t.calls[0].resultText, '{"app":{"id":"a1"}}');
  });

  it("extracts usage and assistant text", () => {
    const t = normalizeTranscript([
      { type: "text", text: "hello " },
      { type: "text_delta", delta: "world" },
      { type: "usage", usage: { input_tokens: 3, output_tokens: 4 } },
      { type: "turn_usage", usage: { input_tokens: 5, output_tokens: 6 } },
    ]);
    assert.equal(t.assistantText, "hello world");
    assert.equal(t.tokensIn, 8);
    assert.equal(t.tokensOut, 10);
  });

  it("ignores unrecognized events without failing", () => {
    const t = normalizeTranscript([{ type: "thought", text: "hmm" }, { type: "system" }]);
    assert.equal(t.calls.length, 0);
  });
});

describe("extractField", () => {
  it("reads the first matching alias", () => {
    assert.equal(extractField('{"catalogId":"cat1"}', ["catalogId", "catalog_id"]), "cat1");
    assert.equal(extractField('{"catalog_id":"cat2"}', ["catalogId", "catalog_id"]), "cat2");
    assert.equal(extractField("{}", ["catalogId"]), null);
  });
});
