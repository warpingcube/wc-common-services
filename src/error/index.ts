import express from "express";

export class ErrorHandler extends Error {
  constructor(public statusCode: number, public message: string) {
    super();
    this.statusCode = statusCode;
    this.message = message;
  }
}

export const handleError = (err: ErrorHandler | any, res: express.Response) => {
  const { statusCode, message } = err;
  res.status(statusCode || 500).json({
    status: "error",
    statusCode,
    message,
  });
};
