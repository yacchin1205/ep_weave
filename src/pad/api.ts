import { Request, Response, NextFunction } from "express";

const apiHandler = require("ep_etherpad-lite/node/handler/APIHandler");
const padManager = require("ep_etherpad-lite/node/db/PadManager");
const importHtml = require("ep_etherpad-lite/node/utils/ImportHtml");
const { Builder } = require("ep_etherpad-lite/static/js/Builder");
const {
  deserializeOps,
  unpack,
} = require("ep_etherpad-lite/static/js/Changeset");

// Admits a request the Etherpad HTTP API would admit: the API key while
// APIKEY.txt exists, otherwise the OAuth bearer token of an admin client.
// checkToken is the API function that performs that check and nothing else.
export const apiAuth = (req: Request, res: Response, next: NextFunction) => {
  const fields = {
    apikey: req.query.apikey,
    api_key: req.query.api_key,
    authorization: req.headers.authorization,
  };
  apiHandler
    .handle(apiHandler.latestApiVersion, "checkToken", fields, req)
    .then(() => next())
    .catch((err: any) => {
      res.status(err.status || 500).send({ error: err.message });
    });
};

// The lines an HTML fragment yields, as the changeset setPadHTML would append
// to an empty pad: one insert op per run of attributes, each carrying the
// author. The scratch pad hands setPadHTML the real pad's attribute pool and
// keeps it from touching the real pad.
const collectLines = async (pool: any, html: string, authorId: string) => {
  let changeset = "";
  const scratch = {
    pool,
    setText: async () => {},
    appendRevision: async (cs: string) => {
      changeset = cs;
    },
  };
  await importHtml.setPadHTML(scratch, html, authorId);
  return changeset;
};

// A changeset that inserts the collected lines before line `line` of `text`
// and keeps every other character with its attributes.
const insertBefore = (text: string, line: number, collected: string) => {
  let offset = 0;
  for (let i = 0; i < line; i++) {
    offset = text.indexOf("\n", offset) + 1;
  }
  const { ops, charBank } = unpack(collected);
  const builder = new Builder(text.length);
  if (offset > 0) {
    builder.keep(offset, line);
  }
  let pos = 0;
  for (const op of deserializeOps(ops)) {
    builder.insert(charBank.slice(pos, pos + op.chars), op.attribs);
    pos += op.chars;
  }
  return builder.toString();
};

// POST /ep_weave/api/insert inserts the lines of an HTML fragment before a
// line of a pad. Unlike setHTML it leaves the rest of the pad as it is, so
// the other authors keep their attribution and the revision holds only the
// change. `rev` must be the pad's head revision the lines were computed
// against; a pad that moved on is refused with 409 and its current head.
export const insertHandler = async (req: Request, res: Response) => {
  const { padID, rev, line, html, authorId } = req.body;
  if (
    typeof padID !== "string" ||
    !Number.isInteger(rev) ||
    !Number.isInteger(line) ||
    typeof html !== "string" ||
    (authorId !== undefined && typeof authorId !== "string")
  ) {
    res.status(400).send({
      error:
        "padID (string), rev (integer), line (integer) and html (string) are required; authorId is an optional string",
    });
    return;
  }
  if (!(await padManager.doesPadExist(padID))) {
    res.status(404).send({ error: `pad ${padID} does not exist` });
    return;
  }
  const pad = await padManager.getPad(padID);
  const head = pad.getHeadRevisionNumber();
  if (rev !== head) {
    res.status(409).send({
      error: `pad ${padID} is at revision ${head}, not ${rev}`,
      rev: head,
    });
    return;
  }
  const text = pad.text();
  const lineCount = text.split("\n").length - 1;
  if (line < 0 || line > lineCount) {
    res.status(400).send({
      error: `line must be between 0 and ${lineCount}, the number of lines`,
    });
    return;
  }
  const collected = await collectLines(pad.pool, html, authorId || "");
  await pad.appendRevision(insertBefore(text, line, collected), authorId || "");
  res.send({ padID, rev: pad.getHeadRevisionNumber() });
};
