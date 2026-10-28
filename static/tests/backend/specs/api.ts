"use strict";

import assert from "assert";
const common = require("ep_etherpad-lite/tests/backend/common");
import { generateJWTToken } from "ep_etherpad-lite/tests/backend/common";
const randomString =
  require("ep_etherpad-lite/static/js/pad_utils").randomString;

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

describe("API for other applications", function () {
  let padID: string;
  let alice: string;

  before(async function () {
    agent = await common.init();
    alice = (await api("createAuthor", { name: "alice" })).authorID;
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
});
