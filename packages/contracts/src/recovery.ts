import { isUuidV7 } from "./runtime.js";

function uuidV7(value: string, name: string): string {
  if (!isUuidV7(value)) throw new TypeError(`${name}:invalid`);
  return value;
}

function root(transactionId: string): string {
  return `installation/recovery-authorizations/${uuidV7(transactionId, "transactionId")}`;
}

export const recoveryAuthorizationPaths = Object.freeze({
  core: (transactionId: string): string => `${root(transactionId)}/core.json`,
  state: (transactionId: string): string => `${root(transactionId)}/state.json`,
  attachment: (transactionId: string): string => `${root(transactionId)}/attachment.json`,
  nativeReceipt: (transactionId: string, operationId: string): string =>
    `${root(transactionId)}/native/${uuidV7(operationId, "operationId")}.json`,
  postSelectionReceipt: (transactionId: string, operationId: string): string =>
    `${root(transactionId)}/receipts/${uuidV7(operationId, "operationId")}.json`,
  archive: (transactionId: string): string => `${root(transactionId)}/archive.json`,
  attachmentArchive: (transactionId: string): string =>
    `${root(transactionId)}/attachment-archive.json`,
});
