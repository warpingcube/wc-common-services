require("newrelic");
require("custom-env").env();

import express from "express";
import winston from "winston";
import proxy from "express-http-proxy";
import cors from "cors";

import { CountriesData } from "./data/countries.model";
import { CurrenciesData } from "./data/currencies.model";

import { Client } from "@googlemaps/google-maps-services-js";

import { privateKey, publicKey } from "./rsa";
import { ApiError, handleError } from "./error";
import redisClient from "./redis";
import { cleanCloudinaryUrl } from "./utils/cleanCloudinaryUrl";

const app = express();

app.use(cors());
app.use(express.json());

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

app.get(
  "/assets/cloudinary/*",
  proxy("https://res.cloudinary.com", {
    proxyReqPathResolver(req) {
      return req.url.replace("/assets/cloudinary", "");
    },
  })
);

app.get("/cache", (req: express.Request, res: express.Response) => {
  const { key, value, post } = req.query;

  if (post != undefined) {
    if (!key) throw new ApiError(400, "key required");
    if (!value) throw new ApiError(400, "value required");

    redisClient
      .set(key + "", value + "")
      .then(() => {
        res.status(201).json({
          key,
          value,
        });
      })
      .catch((err) => {
        handleError(err, res);
      });
  } else {
    if (!key) throw new ApiError(400, "key required");

    redisClient
      .get(key + "")
      .then((value) => {
        if (!value) throw new ApiError(404, `key ${key} not found`);
        res.status(200).json({
          key,
          value,
        });
      })
      .catch((err) => {
        handleError(err, res);
      });
  }
});

app.get("/cache/keys", (req: express.Request, res: express.Response) => {
  redisClient
    .keys("*")
    .then((keys) => {
      res.status(200).json(keys);
    })
    .catch((err) => {
      handleError(err, res);
    });
});

app.post(
  "/cloudinary/commit",
  (req: express.Request, res: express.Response) => {
    const { url } = req.body;
    if (!url) throw new ApiError(400, "url required");

    const isCloudinary = (url + "").includes("res.cloudinary.com");
    if (!isCloudinary) throw new ApiError(400, "not a cloudinary url");

    const cleanUrl = cleanCloudinaryUrl(url + "");

    redisClient
      .keys(`cloudinary:*:pending:${cleanUrl}`)
      .then((keys) => {
        if (keys.length == 0) {
          const commitedKey = `cloudinary:any:commited:${cleanUrl}`;

          redisClient.set(commitedKey, JSON.stringify({ cleanUrl }));

          throw new ApiError(
            200,
            "no matching pending uploads. recording as commited"
          );
        }
        const [key] = keys;
        return redisClient.get(key).then((value) => {
          return { key, value };
        });
      })
      .then(({ key, value }) => {
        const data = JSON.parse(value);
        AppLogger.info(`cloudinary commit ${key} ${JSON.stringify(data)}`);

        return redisClient.del(key).then(() => ({
          key,
          data,
        }));
      })
      .then(({ key, data }) => {
        res.status(200).json(data);
      })
      .catch((err) => {
        handleError(err, res);
      });
  }
);

app.post(
  "/cloudinary/callback",
  (req: express.Request, res: express.Response) => {
    AppLogger.info(`cloudinary callback ${JSON.stringify(req.body)}`);

    const {
      notification_type,
      asset_id,
      public_id,
      resource_type,
      type,
      secure_url,
      folder,
    } = req.body;

    if (notification_type == "upload" && resource_type == "image") {
      const cleanUrl = cleanCloudinaryUrl(secure_url);
      const key = `cloudinary:${resource_type}:pending:${cleanUrl}`;

      const isSkipeable = ["city-academy-media", "edt-media"].find(
        (skippeable) => {
          return skippeable.includes(folder);
        }
      );

      if (isSkipeable) {
        res.status(200).json({
          status: "ok",
          message: "resource skipped",
        });

        return;
      }

      const commitedKey = `cloudinary:any:commited:${cleanUrl}`;

      redisClient.keys(commitedKey).then((keys) => {
        if (keys.length > 0) {
          const [key] = keys;

          redisClient.del(key);

          res.status(200).json({
            status: "ok",
            message: "it was already commited",
          });
        } else {
          const ttl = 60 * 60 * 3;
          const expirationDate = new Date(Date.now() + ttl * 1000);

          const metadata = {
            asset_id,
            public_id,
            resource_type,
            secure_url,
            clean_url: cleanUrl,
            expiration: expirationDate.toISOString(),
          };

          redisClient.set(key, JSON.stringify(metadata));

          res.status(200).json({
            status: "ok",
            message: "metadata saved",
          });
        }
      });

      return;
    }

    res.status(200).json({
      status: "ok",
      message: "notification ignored",
    });
  }
);

app.get(
  "/cloudinary/cleanup",
  (req: express.Request, res: express.Response) => {
    const now = new Date();

    redisClient
      .keys(`cloudinary:*:pending:*`)
      .then((keys) => {
        return Promise.all(
          keys.map(async (key) => {
            const value = JSON.parse(await redisClient.get(key));
            return { key, value };
          })
        );
      })
      .then((data) => {
        return data.filter((record) => {
          const { expiration } = record.value;
          const expirationDate = new Date(expiration);

          return now > expirationDate;
        });
      })
      .then((data) => {
        return Promise.all(
          data.map(async (record) => {
            const { key, value } = record;
            await redisClient.del(key);
            // TODO delete from cloudinary
            return { key, value };
          })
        );
      })
      .then((data) => {
        res.status(200).json(data);
      })
      .catch((err) => {
        handleError(err, res);
      });
  }
);

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
  })
  .catch((err) => {
    AppLogger.error(err);
    AppLogger.warn(`redis not connected`);
  })
  .finally(() => {
    return app.listen(process.env.PORT || 8080, () => {
      AppLogger.info(`app started`);
    });
  });
