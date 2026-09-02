import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectToolAbsence, parseReadinessReport } from "../src/readiness.ts";
import { call, resetSeq } from "./helpers.ts";

describe("parseReadinessReport", () => {
  it("parses a healthy report", () => {
    const r = parseReadinessReport(
      JSON.stringify({ services_healthy: true, c1dev_http_ok: true, checked_at: "2026-09-02T00:00:00Z", details: "ok" }),
    );
    assert.ok(r);
    assert.equal(r.services_healthy, true);
    assert.equal(r.c1dev_http_ok, true);
  });

  it("rejects malformed reports", () => {
    assert.equal(parseReadinessReport("not json"), null);
    assert.equal(parseReadinessReport('{"services_healthy":"yes"}'), null);
    assert.equal(parseReadinessReport('{"c1dev_http_ok":true}'), null);
  });
});

describe("detectToolAbsence", () => {
  it("detects the READINESS_FAILED marker", () => {
    const t = { calls: [], assistantText: "READINESS_FAILED", turns: null, tokensIn: null, tokensOut: null };
    const r = detectToolAbsence(t);
    assert.equal(r.absent, true);
  });

  it("detects MCP tool-not-found errors on c1dev tools", () => {
    resetSeq();
    const t = {
      calls: [
        call("c1_connector_authoring_get_authoring_guide", {
          ok: false,
          error: "unknown tool: mcp__c1dev__c1_connector_authoring_get_authoring_guide",
          result: "",
        }),
      ],
      assistantText: "",
      turns: null,
      tokensIn: null,
      tokensOut: null,
    };
    const r = detectToolAbsence(t);
    assert.equal(r.absent, true);
  });

  it("does not flag ordinary tool errors", () => {
    resetSeq();
    const t = {
      calls: [
        call("c1_connector_authoring_get_draft", {
          ok: false,
          error: "NotFound: draft does not exist",
          result: "",
        }),
      ],
      assistantText: "",
      turns: null,
      tokensIn: null,
      tokensOut: null,
    };
    assert.equal(detectToolAbsence(t).absent, false);
  });

  it("does not flag a clean transcript", () => {
    resetSeq();
    const t = {
      calls: [call("c1_connector_authoring_get_authoring_guide", { result: "# guide" })],
      assistantText: "all good",
      turns: null,
      tokensIn: null,
      tokensOut: null,
    };
    assert.equal(detectToolAbsence(t).absent, false);
  });
});
