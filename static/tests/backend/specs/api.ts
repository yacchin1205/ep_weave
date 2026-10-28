"use strict";

import assert from "assert";
const common = require("ep_etherpad-lite/tests/backend/common");
import { generateJWTToken } from "ep_etherpad-lite/tests/backend/common";
const randomString =
  require("ep_etherpad-lite/static/js/pad_utils").randomString;
const {
  deserializeOps,
  unpack,
} = require("ep_etherpad-lite/static/js/Changeset");

const apiVersion = "1.3.1";
let agent: any;

const api = async (method: string, params: Record<string, string>) => {
  const res = await agent
    .get(`/api/${apiVersion}/${method}?${new URLSearchParams(params)}`)
    .set("Authorization", await generateJWTToken());
  if (res.body.code !== 0) {
    throw new Error(`${method}: ${res.body.message}`);
  }
  return res.body.data;
};

const insert = async (body: object) =>
  agent
    .post("/ep_weave/api/insert")
    .set("Authorization", await generateJWTToken())
    .send(body);

describe("API for other applications", function () {
  let padID: string;
  let alice: string;
  let bob: string;

  before(async function () {
    agent = await common.init();
    alice = (await api("createAuthor", { name: "alice" })).authorID;
    bob = (await api("createAuthor", { name: "bob" })).authorID;
    padID = randomString(5);
    await api("createPad", { padID, authorId: alice });
    await api("setHTML", {
      padID,
      html: "<html><body><p>Title</p><p>first</p><p>#tag</p></body></html>",
      authorId: alice,
    });
  });

  it("refuses requests without a token", async function () {
    await agent.get("/ep_weave/api/search?query=*:*").expect(401);
    await agent.post("/ep_weave/api/insert").send({}).expect(401);
  });

  it("searches with paging", async function () {
    const res = await agent
      .get("/ep_weave/api/search?query=*:*&rows=1&start=0")
      .set("Authorization", await generateJWTToken())
      .expect(200);
    assert.ok("numFound" in JSON.parse(res.text));
    await agent
      .get("/ep_weave/api/search?query=*:*&rows=many")
      .set("Authorization", await generateJWTToken())
      .expect(400);
  });

  it("inserts lines before a line and keeps the rest as it was", async function () {
    const { revisions } = await api("getRevisionsCount", { padID });
    const res = await insert({
      padID,
      rev: revisions,
      line: 2,
      html: "<p>second</p><ul><li>item</li></ul>",
      authorId: bob,
    }).expect(200);
    assert.deepEqual(res.body, { padID, rev: revisions + 1 });

    const { text } = await api("getText", { padID });
    assert.deepEqual(text.split("\n"), [
      "Title",
      "first",
      "second",
      "\t* item",
      "#tag",
      "",
      "",
    ]);

    // The revision keeps the first two lines untouched, attributes included,
    // and only inserts, every insert attributed to bob.
    const changeset = await api("getRevisionChangeset", {
      padID,
      rev: String(revisions + 1),
    });
    const ops = [...deserializeOps(unpack(changeset).ops)];
    assert.deepEqual(
      { opcode: ops[0].opcode, chars: ops[0].chars, attribs: ops[0].attribs },
      { opcode: "=", chars: "Title\nfirst\n".length, attribs: "" }
    );
    const { pool } = await api("getAttributePool", { padID });
    const bobNum = Object.entries(pool.numToAttrib)
      .find(([, attrib]) => (attrib as string[])[0] === "author" && (attrib as string[])[1] === bob)![0];
    for (const op of ops.slice(1)) {
      assert.equal(op.opcode, "+");
      assert.ok(
        op.attribs.split("*").includes(parseInt(bobNum).toString(36)),
        `${op.attribs} lacks author ${bob}`
      );
    }
  });

  it("appends at the line count", async function () {
    const { revisions } = await api("getRevisionsCount", { padID });
    const { text: before } = await api("getText", { padID });
    const lineCount = before.split("\n").length - 1;
    await insert({
      padID,
      rev: revisions,
      line: lineCount,
      html: "<p>last</p>",
      authorId: bob,
    }).expect(200);
    const { text } = await api("getText", { padID });
    assert.equal(text, `${before}last\n`);
  });

  it("refuses a stale revision with the current one", async function () {
    const { revisions } = await api("getRevisionsCount", { padID });
    const res = await insert({
      padID,
      rev: revisions - 1,
      line: 0,
      html: "<p>late</p>",
    }).expect(409);
    assert.equal(res.body.rev, revisions);
  });

  it("refuses a line past the end, an unknown pad and a bad body", async function () {
    const { revisions } = await api("getRevisionsCount", { padID });
    await insert({ padID, rev: revisions, line: 99, html: "<p>x</p>" }).expect(400);
    await insert({ padID: "nope", rev: 0, line: 0, html: "<p>x</p>" }).expect(404);
    await insert({ padID, rev: "0", line: 0, html: "<p>x</p>" }).expect(400);
  });
});
