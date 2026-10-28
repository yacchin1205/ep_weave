import { Request, Response, NextFunction } from "express";

const apiHandler = require("ep_etherpad-lite/node/handler/APIHandler");

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
