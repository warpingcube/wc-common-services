require("newrelic");
require("custom-env").env();

import express from "express";
import winston from "winston";
import cors from "cors";

import { CountriesData } from "./data/countries.model";
import { CurrenciesData } from "./data/currencies.model";

import { Client } from "@googlemaps/google-maps-services-js";

import { privateKey, publicKey } from "./rsa";
import { ApiError, handleError } from "./error";
import redisClient from "./redis";

const app = express();

app.use(cors());

export const AppLogger = winston.createLogger({
  level: "info",
  format: winston.format.printf(
    (info) =>
      `${new Date().toISOString()} ${info.level.toUpperCase()}: ${info.message}`
  ),
  transports: [new winston.transports.Console()],
});

const rsaKeys = {
  public: process.env.RSA_PUBLIC_KEY.split("\\n").join("\n"),
  private: process.env.RSA_PRIVATE_KEY.split("\\n").join("\n"),
};

AppLogger.info("rsaKeys ready");

/** HANDLERS */

app.get("/countries", (_req: express.Request, res: express.Response) => {
  res.status(200).json(CountriesData);
});

app.get("/currencies", (_req: express.Request, res: express.Response) => {
  res.status(200).json(CurrenciesData);
});

app.get("/rsa/enc", (req: express.Request, res: express.Response) => {
  const { plain } = req.query;

  if (!plain) throw new ApiError(400, "plain required");

  const secure = privateKey(rsaKeys.private).encryptPrivate(plain, "base64");
  const reversed = publicKey(rsaKeys.public).decryptPublic(secure, "utf8");

  res.status(200).json({
    plain: reversed,
    secure: secure,
  });
});

app.get("/rsa/dec", (req: express.Request, res: express.Response) => {
  const _secure = req.query.secure;

  if (!_secure) throw new ApiError(400, "secure required");

  const secure = (_secure + "").split(" ").join("+");

  res.status(200).json({
    secure: secure,
    plain: publicKey(rsaKeys.public).decryptPublic(secure + "", "utf8"),
  });
});

app.get("/addresses/geocode", (req: express.Request, res: express.Response) => {
  const { query, apiKey } = req.query;

  if (!query) throw new ApiError(400, "query required");
  if (!apiKey) throw new ApiError(400, "api key required");

  const client = new Client({});

  client
    .geocode({
      params: {
        address: query + "",
        key: apiKey + "",
      },
    })
    .then((response) => {
      if (response.data.results.length == 0)
        throw new ApiError(404, "no results found");
      res.status(200).json(response.data.results[0]);
    })
    .catch((err) => {
      res.status(500).json({
        error: "google error",
      });
    });
});

app.get("/health-check", (req: express.Request, res: express.Response) => {
  res.status(200).json({
    status: "ok",
  });
});

app.get("*", (req: express.Request, res: express.Response) => {
  throw new ApiError(404, "route not found");
});

app.use(
  (
    err: Error | any,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    handleError(err, res);
  }
);

redisClient
  .connect()
  .then(() => {
    AppLogger.info(`redis connected`);

    return app.listen(process.env.PORT || 8080, () => {
      AppLogger.info(`app started`);
    });
  })
  .catch((err) => {
    AppLogger.error(err);
    process.exit(1);
  });
