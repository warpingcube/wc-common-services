import express from "express";
import winston from "winston";
import { CountriesData } from "./data/countries.model";
import { CurrenciesData } from "./data/currencies.model";
import { Client } from "@googlemaps/google-maps-services-js";
const loadedConfig: {
  main: {
    env: boolean;
    dir: string;
    encoding: string;
    configDotEnv: { path: string };
  };
} = require("custom-env").env();
export const ENV = loadedConfig.main.configDotEnv.path ? "dev" : "prod";
import { keys, privateKey, publicKey } from "./rsa";
import { ErrorHandler, handleError } from "./error";
import cors from "cors";

const app = express();
const port = process.env.PORT || 8080;

app.use(cors());

export const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
});

keys.public = process.env.RSA_PUBLIC_KEY.split("\\n").join("\n");
keys.private = process.env.RSA_PRIVATE_KEY.split("\\n").join("\n");

/** HANDLERS */

app.get("/countries", (_req: express.Request, res: express.Response) => {
  res.status(200).json(CountriesData);
});

app.get("/currencies", (_req: express.Request, res: express.Response) => {
  res.status(200).json(CurrenciesData);
});

app.get("/rsa/enc", (req: express.Request, res: express.Response) => {
  const { plain } = req.query;

  if (!plain) throw new Error("plain required");

  const secure = privateKey().encryptPrivate(plain, "base64");
  const reversed = publicKey().decryptPublic(secure, "utf8");

  res.status(200).json({
    plain: reversed,
    secure: secure,
  });
});

app.get("/rsa/dec", (req: express.Request, res: express.Response) => {
  const _secure = req.query.secure;

  if (!_secure) throw new Error("secure required");

  const secure = (_secure + "").split(" ").join("+");

  res.status(200).json({
    secure: secure,
    plain: publicKey().decryptPublic(secure + "", "utf8"),
  });
});

app.get("/addresses/geocode", (req: express.Request, res: express.Response) => {
  const { query, apiKey } = req.query;

  if (!query) throw new ErrorHandler(500, "query required");
  if (!apiKey) throw new ErrorHandler(500, "api key required");

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
        throw new ErrorHandler(404, "no results found");
      res.status(200).json(response.data.results[0]);
    })
    .catch((err) => {
      res.status(500).json({
        error: "google error",
      });
    });
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

app.listen(port, () => {
  logger.info(`app started @ localhost:${port}`);
});
