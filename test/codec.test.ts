import { describe, it, expect } from "vitest";
import {
  encodeHeader,
  decodeHeader,
  encodeMessage,
  createHandshakeRequest,
  validateHandshakeResponse,
  RPC_REPLY_RESULT,
  RPC_REPLY_FAIL,
  RPC_REQUEST_QUIT,
  CR_WRONG_USAGE,
} from "../src/dfhack/codec.js";

describe("encodeHeader / decodeHeader", () => {
  it("round-trips positive ids", () => {
    const buf = encodeHeader(42, 1024);
    const decoded = decodeHeader(buf);
    expect(decoded).toEqual({ id: 42, size: 1024 });
  });

  it("round-trips negative ids (RPC reply codes)", () => {
    const buf = encodeHeader(RPC_REPLY_RESULT, 500);
    const decoded = decodeHeader(buf);
    expect(decoded).toEqual({ id: -1, size: 500 });
  });

  it("round-trips RPC_REPLY_FAIL with command_result as size", () => {
    const buf = encodeHeader(RPC_REPLY_FAIL, CR_WRONG_USAGE);
    const decoded = decodeHeader(buf);
    expect(decoded).toEqual({ id: -2, size: 2 });
  });

  it("round-trips zero size", () => {
    const buf = encodeHeader(0, 0);
    const decoded = decodeHeader(buf);
    expect(decoded).toEqual({ id: 0, size: 0 });
  });

  it("returns null for insufficient data", () => {
    const buf = Buffer.alloc(4);
    expect(decodeHeader(buf)).toBeNull();
  });

  it("header is exactly 8 bytes", () => {
    const buf = encodeHeader(1, 100);
    expect(buf.length).toBe(8);
  });
});

describe("encodeMessage", () => {
  it("produces header + payload", () => {
    const payload = new Uint8Array([0x01, 0x02, 0x03]);
    const msg = { id: 10, data: payload };
    const buf = encodeMessage(msg);

    // Total = 8 byte header + 3 byte payload = 11
    expect(buf.length).toBe(11);
    // Check header id
    expect(buf.readInt16LE(0)).toBe(10);
    // Check header size
    expect(buf.readInt32LE(4)).toBe(3);
    // Check payload bytes
    expect(buf[8]).toBe(0x01);
    expect(buf[9]).toBe(0x02);
    expect(buf[10]).toBe(0x03);
  });

  it("handles empty payload", () => {
    const msg = { id: 0, data: new Uint8Array(0) };
    const buf = encodeMessage(msg);
    expect(buf.length).toBe(8);
    expect(buf.readInt32LE(4)).toBe(0);
  });

  it("handles RPC_REQUEST_QUIT message", () => {
    const msg = { id: RPC_REQUEST_QUIT, data: new Uint8Array(0) };
    const buf = encodeMessage(msg);
    expect(buf.readInt16LE(0)).toBe(-4);
    expect(buf.readInt32LE(4)).toBe(0);
  });
});

describe("handshake", () => {
  it("creates valid handshake request", () => {
    const req = createHandshakeRequest();
    expect(req.length).toBe(12);

    // "DFHack?\n" = 7 bytes + \n = 8 bytes, + int32 = 12
    const magic = req.subarray(0, 8).toString("binary");
    expect(magic).toBe("DFHack?\n");

    const version = req.readInt32LE(8);
    expect(version).toBe(1);
  });

  it("validates correct handshake response", () => {
    const buf = Buffer.alloc(12);
    buf.write("DFHack!\n", 0, 8, "binary");
    buf.writeInt32LE(1, 8);

    expect(validateHandshakeResponse(buf)).toBe(true);
  });

  it("rejects wrong magic in handshake response", () => {
    const buf = Buffer.alloc(12);
    buf.write("BADMAG!\n", 0, 8, "binary");
    buf.writeInt32LE(1, 8);

    expect(validateHandshakeResponse(buf)).toBe(false);
  });

  it("rejects short handshake response", () => {
    const buf = Buffer.alloc(8);
    expect(validateHandshakeResponse(buf)).toBe(false);
  });
});

