export interface DwarfMessage {
  id: number;
  data: Uint8Array;
  failureCode?: number;
}

export const RPC_REPLY_RESULT = -1;
export const RPC_REPLY_FAIL = -2;
export const RPC_REPLY_TEXT = -3;
export const RPC_REQUEST_QUIT = -4;

export const CR_LINK_FAILURE = -3;
export const CR_NEEDS_CONSOLE = -2;
export const CR_NOT_IMPLEMENTED = -1;
export const CR_OK = 0;
export const CR_FAILURE = 1;
export const CR_WRONG_USAGE = 2;
export const CR_NOT_FOUND = 3;

const REQUEST_MAGIC = Buffer.from("DFHack?\n\x01\x00\x00\x00", "binary");
const RESPONSE_MAGIC_PREFIX = "DFHack!\n";

export function encodeHeader(id: number, size: number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeInt16LE(id, 0);
  buf.writeInt16LE(0, 2);
  buf.writeInt32LE(size, 4);
  return buf;
}

export function decodeHeader(buf: Buffer): { id: number; size: number } | null {
  if (buf.length < 8) return null;
  return {
    id: buf.readInt16LE(0),
    size: buf.readInt32LE(4),
  };
}

export function encodeMessage(msg: DwarfMessage): Buffer {
  const header = encodeHeader(msg.id, msg.data.length);
  return Buffer.concat([header, Buffer.from(msg.data)]);
}

export function createHandshakeRequest(): Buffer {
  return REQUEST_MAGIC;
}

export function validateHandshakeResponse(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  const prefix = buf.subarray(0, 8).toString("binary");
  return prefix === RESPONSE_MAGIC_PREFIX;
}