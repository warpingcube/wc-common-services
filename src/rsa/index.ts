import NodeRSA from "node-rsa";

export const publicKey = (key: string) => new NodeRSA(key);
export const privateKey = (key: string) => new NodeRSA(key);
