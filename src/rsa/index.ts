import NodeRSA from "node-rsa";

export let keys = {
  public: "",
  private: "",
};

export const publicKey = () => new NodeRSA(keys.public);
export const privateKey = () => new NodeRSA(keys.private);
