import express from "express";
import { AppLogger } from "..";

export class ApiError extends Error {
  constructor(public statusCode: number, public message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export const handleError = (err: ApiError | any, res: express.Response) => {
  const { statusCode, message } = err;

  AppLogger.error(err);

  res.status(statusCode || 500).json({
    status: "error",
    statusCode,
    message,
  });
};
